// These values should come from environment variables in production
export const projectId = import.meta.env.VITE_SUPABASE_URL?.replace('https://', '').replace('.supabase.co', '') || '';
export const publicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
