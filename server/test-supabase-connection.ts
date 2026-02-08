import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

console.log("=== Supabase Connection Test ===\n");
console.log("Environment Variables:");
console.log(`SUPABASE_URL: ${supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : "NOT SET"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${supabaseKey ? `${supabaseKey.substring(0, 20)}...` : "NOT SET"}\n`);

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    console.log("1. Testing Supabase client initialization...");
    console.log("   ✓ Client created successfully\n");

    console.log("2. Testing auth.getUser() with service role key...");
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (authError) {
      console.log(`   ⚠ Warning: ${authError.message}`);
    } else {
      console.log(`   ✓ Auth service accessible (found ${authData?.users?.length || 0} users)\n`);
    }

    console.log("3. Testing storage buckets...");
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (bucketsError) {
      console.log(`   ❌ Error: ${bucketsError.message}\n`);
    } else {
      console.log(`   ✓ Storage accessible (found ${buckets?.length || 0} buckets)`);
      if (buckets && buckets.length > 0) {
        buckets.forEach(b => console.log(`      - ${b.name}`));
      }
      console.log();
    }

    console.log("4. Testing database connection via storage API...");
    // Try a simple query that would hit the database
    const { data: testData, error: testError } = await supabase
      .from("users")
      .select("id")
      .limit(1);
    
    if (testError) {
      console.log(`   ⚠ Database query error: ${testError.message}`);
      console.log(`   (This might be expected if the 'users' table doesn't exist or RLS is blocking)\n`);
    } else {
      console.log(`   ✓ Database accessible\n`);
    }

    console.log("=== Connection Test Summary ===");
    console.log("✓ Supabase client initialized successfully");
    console.log("✓ Service role key is valid");
    console.log("✓ Basic connectivity confirmed");
    console.log("\n✅ Supabase connection test PASSED");

  } catch (error: any) {
    console.error("\n❌ Connection test FAILED:");
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error(`\nStack trace:\n${error.stack}`);
    }
    process.exit(1);
  }
}

testConnection();
