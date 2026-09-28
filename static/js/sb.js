// Supabase client — única fonte de verdade para URL e chave
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://acdnfrkefynncuiyuhgv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7w9aMQVmzpEh4QPhAry9GQ_o1rEdILG';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { params: { eventsPerSecond: 20 } }
});

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
