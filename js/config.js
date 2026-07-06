const { createClient } = window.supabase;

/* Aflæs hash FØR klienten oprettes — supabase-js fjerner den under detectSessionInUrl */
const initialHash = window.location.hash || "";
export let recoveryMode = initialHash.indexOf("type=recovery") !== -1;
export const recoveryLinkError = initialHash.indexOf("error_code=otp_expired") !== -1 || initialHash.indexOf("error=access_denied") !== -1;
export function setRecoveryMode(v){ recoveryMode = v; }

const SB_URL = 'https://iduotqxkohuezxkveawc.supabase.co';
const SB_KEY = 'sb_publishable_SHYSpCyVKFwf4jOwg8eSXA_9GzDcf5j';
export const sb = createClient(SB_URL, SB_KEY);

export const GENERIC_ERR = "Noget gik galt. Prøv igen.";
