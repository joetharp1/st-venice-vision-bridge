// Follow-up scheduling is separate from image publication and never replays on reload.
export function createPortraitContinuation({ getContext, isGenerating, hasDraft, generate,
    enabled = () => true, onError = () => {}, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout }) {
    let pending = null, timer = null;
    const seen = new WeakSet();
    const lastUser = c => c.chat.findLast(m => m.is_user && !m.is_system);
    function cancel() {
        pending = null;
        if (timer !== null) clearTimer(timer);
        timer = null;
    }
    function valid(p) {
        const c = getContext();
        return enabled() && p.isCurrent() && c.chat === p.context.chat && c.chatId === p.context.chatId
            && c.characterId === p.context.characterId && c.chat[p.messageId] === p.message
            && lastUser(c) === p.userMessage && !hasDraft() && now() < p.expiresAt;
    }
    function arm() {
        if (timer !== null) clearTimer(timer);
        timer = setTimer(() => { timer = null; void flush(); }, 250);
    }
    async function flush() {
        const p = pending;
        if (!p) return;
        if (!valid(p)) { cancel(); return; }
        if (isGenerating()) { arm(); return; }
        // Consume before Generate (including its synchronous events). Never retry.
        cancel();
        try { await generate('normal', { automatic_trigger: true }); }
        catch (error) { onError(error); }
    }
    function enqueue(p) {
        const message = p.context.chat[p.messageId];
        if (!message || seen.has(message)) return false;
        seen.add(message); cancel();
        pending = { ...p, message, expiresAt: now() + 150000 };
        arm(); return true;
    }
    function generationStarted(type, options, dryRun) {
        if (!pending || dryRun) return;
        // ST normally follows a successful tool result with its own normal
        // generation. Count that as the one reaction instead of adding another.
        if (!valid(pending) || type === 'normal' || type === 'continue') cancel();
    }
    return { enqueue, flush, generationStarted, generationEnded: () => { if (pending) arm(); }, cancel };
}
