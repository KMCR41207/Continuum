/** Reject known privileged-key formats before Vite embeds public configuration. */
export function isPrivilegedKey(key: string) {
  if (key.startsWith('sb_secret_') || key.startsWith('sk_live_') || key.startsWith('sk_test_')) return true;
  if (key.startsWith('eyJ')) {
    try {return JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role';}catch{return false;}
  }
  return false;
}
