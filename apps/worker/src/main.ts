// Worker process (SPEC §3.3): outbox dispatch, notifications, scheduled jobs (pg-boss).
// Job definitions live with their modules in @jappo/api so API and worker share code.
import '@jappo/api/worker-main';
