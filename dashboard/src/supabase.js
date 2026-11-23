import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// send one or more commands: send('SS-01', 'R:ON')
export async function send(target, ...commands) {
  const rows = commands.map((command) => ({ node_id: target, command }))
  const { error } = await supabase.from('commands').insert(rows)
  if (error) alert('Command failed: ' + error.message)
}
