require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan variables de entorno para Supabase Storage (SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY).");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
