// Forge mentor agent: Claude with tools that can read the user's Forge data
// and act on it (plan the week, set goals, build a gym session...).
//
// ForgeAgent.run(history, text, host, hooks) runs one user turn as a tool loop
// against the Messages API (through Forge's Supabase proxy; the browser never
// holds the API key) and resolves to { reply, actions, stopped }.
//
// host (supplied by forges.html):
//   host.proxyUrl, host.headers()       → where and how to call Claude
//   host.prompt()                       → { fixed, live }: the fixed part (persona,
//                                          rules, profile) is prompt-cached; `live`
//                                          is today's status and changes each turn
//   host.read.<tool>(input)             → data for read tools (plain objects)
//   host.write.<tool>(input)            → { ok, message } for tools that change things
//   host.exerciseIds                    → valid gym exercise ids (for create_gym_plan)
// hooks: onStatus(text) while a tool runs, onAction(message) after a change.
//
// Design notes:
// - Only tool_use / tool_result blocks for THIS turn go to the API with the
//   history; stored history stays plain text (see forges.html state.mentorHistory).
// - Assistant content is appended back unchanged, so thinking blocks survive
//   between tool steps (required with adaptive thinking).
// - Caching: one breakpoint on the fixed system block + automatic caching for the
//   growing message tail, so each step re-reads tools + prompt + history cheaply.

const ForgeAgent = (function () {
  const MODEL = 'claude-opus-5';
  const EFFORT = 'medium';       // coaching chat: medium holds quality at lower cost
  const MAX_TOKENS = 6000;       // thinking + reply; the proxy caps at the same value
  const MAX_STEPS = 8;           // tool rounds per user message
  const HISTORY_MESSAGES = 30;   // older chat is dropped from the request, not from storage

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Tool definitions. `kind` decides where the handler lives (host.read / host.write)
  // and `status` is what the chat shows while it runs.
  function tools(host) {
    const t = [
      { kind: 'read', status: 'Looking at your progress', name: 'get_progress_history',
        description: "Daily goal and non-negotiable completion for recent days, plus streak and XP. Use when the user asks how they've been doing, or before a weekly review.",
        input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 60, description: 'How many past days (default 14).' } } } },
      { kind: 'read', status: 'Checking your gym history', name: 'get_gym_data',
        description: 'Recent gym training: sessions with sets, each lift\'s estimated-max trend, belt ranks, sets per muscle this week and which muscles went untrained, plus the coach\'s next target per lift. Use for any training question or before suggesting a session.',
        input_schema: { type: 'object', properties: {
          days: { type: 'integer', minimum: 1, maximum: 90, description: 'Look-back window in days (default 28).' },
          exercise: { type: 'string', description: 'Optional: narrow to one exercise, by name or id.' } } } },
      { kind: 'read', status: 'Reading your week', name: 'get_week_plan',
        description: "The user's weekly hour-by-hour schedule (Monday-Sunday, 6:00-22:00; only filled slots) and upcoming events for the next 3 weeks. Always call this before scheduling anything so you don't clash with existing plans.",
        input_schema: { type: 'object', properties: {} } },
      { kind: 'read', status: 'Searching your notes', name: 'search_notes',
        description: "Search the user's saved notes by keyword. Returns matching titles and the start of each note.",
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },

      { kind: 'write', status: 'Updating your goals', name: 'complete_goal',
        description: "Mark one of today's daily goals as done, matched by its label. Only when the user clearly says they finished it.",
        input_schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } },
      { kind: 'write', status: 'Updating your non-negotiables', name: 'complete_nonnegotiable',
        description: "Mark one of today's non-negotiables as done, matched by its label. Only when the user clearly says they finished it.",
        input_schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } },
      { kind: 'write', status: 'Setting a goal', name: 'add_goal',
        description: "Add a goal to today's daily goals (there are 5 slots). Use when the user asks you to set goals or agrees to one you suggested.",
        input_schema: { type: 'object', properties: { label: { type: 'string', description: 'Short and concrete, under 60 characters.' } }, required: ['label'] } },
      { kind: 'write', status: 'Planning your week', name: 'schedule_task',
        description: 'Put a task into one hour of the weekly schedule. Call get_week_plan first. Never overwrite a filled slot unless the user asked you to replace it (replace: true). Call it once per hour block; several calls in one step are fine.',
        input_schema: { type: 'object', properties: {
          day: { type: 'string', enum: DAYS },
          hour: { type: 'integer', minimum: 6, maximum: 22, description: '24-hour clock start hour.' },
          task: { type: 'string', description: 'Under 40 characters.' },
          replace: { type: 'boolean' } }, required: ['day', 'hour', 'task'] } },
      { kind: 'write', status: 'Adding an event', name: 'add_event',
        description: 'Add a dated event to the calendar (deadlines, appointments, races).',
        input_schema: { type: 'object', properties: {
          name: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, note: { type: 'string' } }, required: ['name', 'date'] } },
      { kind: 'write', status: 'Saving a note', name: 'add_note',
        description: "Save a note to the user's Notes page, for ideas, insights or plans worth keeping.",
        input_schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title', 'content'] } },
      { kind: 'write', status: 'Logging health', name: 'log_health',
        description: "Log today's sleep, steps, water or calories when the user mentions them. Only include the values they gave.",
        input_schema: { type: 'object', properties: {
          sleep_hours: { type: 'number' }, steps: { type: 'number' }, water_glasses: { type: 'number' }, calories: { type: 'number' } } } },
      { kind: 'write', status: 'Adding a task', name: 'add_hustle_task',
        description: "Add a task to one of the user's side projects, matched by project name.",
        input_schema: { type: 'object', properties: { hustle_name: { type: 'string' }, task: { type: 'string' } }, required: ['hustle_name', 'task'] } },
    ];
    if (host.exerciseIds && host.exerciseIds.length) {
      t.push({ kind: 'write', status: 'Building your session', name: 'create_gym_plan',
        description: "Save a gym session as one of the user's templates (it appears in Gym > Train > Your templates, ready to start). Check get_gym_data first so the plan targets what they actually need.",
        input_schema: { type: 'object', properties: {
          name: { type: 'string', description: 'Short template name, e.g. "Upper B".' },
          exercises: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', enum: host.exerciseIds } } },
          required: ['name', 'exercises'] } });
    }
    return t;
  }

  const TOOL_RULES = `
USING YOUR TOOLS:
- You can look things up (progress, gym history, the week's schedule, notes) instead of guessing. Do that before giving advice that depends on the data.
- You can change things: set and complete goals, schedule tasks, add events, save notes, log health, add project tasks, and save gym sessions. Only change things the user asked for or clearly agreed to. When a plan needs several changes, make them all, then summarise what you did in one short list.
- Never overwrite something the user already planned unless they asked. If a slot is taken, pick another or ask.
- If a tool returns an error, say plainly what didn't work.
- Keep replies short. The user is on their phone.`;

  // Light validation of model tool input at the boundary (schemas aren't strict).
  function validate(tool, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Input must be an object.';
    for (const k of tool.input_schema.required || []) {
      if (input[k] === undefined || input[k] === null || input[k] === '') return `Missing "${k}".`;
    }
    return null;
  }

  async function call(host, system, toolDefs, messages) {
    const res = await fetch(host.proxyUrl, {
      method: 'POST', headers: host.headers(),
      body: JSON.stringify({
        model: MODEL, max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' }, output_config: { effort: EFFORT },
        fallbacks: 'default',               // server-side retry on a safety refusal
        cache_control: { type: 'ephemeral' }, // automatic caching of the message tail
        system, tools: toolDefs, messages,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.type === 'error' || data.error) {
      const msg = (data.error && (data.error.message || data.error)) || ('HTTP ' + res.status);
      throw new Error(typeof msg === 'string' ? msg : 'The mentor is unavailable right now.');
    }
    return data;
  }

  const textOf = data => (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('').trim();

  async function run(history, userText, host, hooks) {
    hooks = hooks || {};
    const defs = tools(host);
    const byName = Object.fromEntries(defs.map(d => [d.name, d]));
    const toolDefs = defs.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
    const p = host.prompt();
    const system = [
      { type: 'text', text: p.fixed + '\n' + TOOL_RULES, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: p.live },
    ];
    let messages = history.slice(-HISTORY_MESSAGES)
      .filter(m => m && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
    while (messages.length && messages[0].role !== 'user') messages.shift();
    // merge any consecutive same-role entries (e.g. [ACTION] lines) so roles alternate
    messages = messages.reduce((out, m) => {
      const last = out[out.length - 1];
      if (last && last.role === m.role) last.content += '\n' + m.content; else out.push({ ...m });
      return out;
    }, []);
    if (messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1].content += '\n' + userText;
    else messages.push({ role: 'user', content: userText });

    const actions = [];
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await call(host, system, toolDefs, messages);
      if (data.stop_reason === 'refusal') {
        return { reply: "I can't help with that one. Ask me something else about your goals, training or week.", actions, stopped: 'refusal' };
      }
      if (data.stop_reason !== 'tool_use') {
        const reply = textOf(data) || (actions.length ? 'Done.' : 'No response.');
        return { reply: data.stop_reason === 'max_tokens' ? reply + ' …' : reply, actions, stopped: data.stop_reason };
      }
      messages.push({ role: 'assistant', content: data.content });
      const results = [];
      for (const block of data.content.filter(b => b.type === 'tool_use')) {
        const tool = byName[block.name];
        let result;
        if (!tool) result = { ok: false, message: 'Unknown tool: ' + block.name };
        else {
          const bad = validate(tool, block.input);
          if (bad) result = { ok: false, message: bad };
          else {
            if (hooks.onStatus) hooks.onStatus(tool.status + '…');
            try {
              if (tool.kind === 'read') result = { ok: true, data: await host.read[tool.name](block.input) };
              else result = await host.write[tool.name](block.input);
            } catch (e) { result = { ok: false, message: 'Tool failed: ' + (e && e.message || e) }; }
            if (tool.kind === 'write' && result && result.ok) {
              actions.push(result.message);
              if (hooks.onAction) hooks.onAction(result.message);
            }
          }
        }
        results.push({
          type: 'tool_result', tool_use_id: block.id,
          content: result.data !== undefined ? JSON.stringify(result.data) : String(result.message || ''),
          ...(result.ok ? {} : { is_error: true }),
        });
      }
      // all results for this step go back in ONE user message (keeps parallel calls working)
      messages.push({ role: 'user', content: results });
    }
    return { reply: actions.length ? "That's everything I could get done in one go. Ask me to keep going if something's missing." : 'That took too many steps. Try asking for one thing at a time.', actions, stopped: 'max_steps' };
  }

  return { run, MODEL, DAYS };
})();
