require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabase = null;

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan variables de entorno para Supabase Storage (SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY).");
} else {
  supabase = createClient(supabaseUrl, supabaseKey);
}

module.exports = supabase;
