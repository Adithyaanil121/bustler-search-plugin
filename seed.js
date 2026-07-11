const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('./db');

async function seedTable(tableName, csvFileName, schemaDef) {
  const filePath = path.join(__dirname, 'dummy_data', csvFileName);
  
  // Drop table if exists
  await db.schema.dropTableIfExists(tableName);
  
  // Create table
  await db.schema.createTable(tableName, table => {
    for (const [col, type] of Object.entries(schemaDef)) {
      if (type === 'string') table.string(col);
      if (type === 'text') table.text(col);
      if (type === 'integer') table.integer(col);
      if (type === 'float') table.float(col);
      if (type === 'boolean') table.boolean(col);
    }
  });

  console.log(`Created table: ${tableName}`);

  // Parse CSV and insert
  const results = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        const cleanData = {};
        for (const key of Object.keys(schemaDef)) {
          cleanData[key] = data[key] !== undefined ? data[key] : null;
        }
        results.push(cleanData);
      })
      .on('end', async () => {
        try {
          if (results.length > 0) {
            // Batch insert in chunks of 50
            const chunkSize = 50;
            for (let i = 0; i < results.length; i += chunkSize) {
              await db(tableName).insert(results.slice(i, i + chunkSize));
            }
          }
          console.log(`Inserted ${results.length} rows into ${tableName}`);
          resolve();
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject);
  });
}

async function run() {
  try {
    console.log('Starting database seed...');

    await seedTable('categories', 'categories.csv', {
      id: 'string',
      name: 'string',
      slug: 'string',
      description: 'text',
      image_url: 'text',
      icon: 'string',
      display_order: 'integer',
      is_active: 'string',
      is_featured: 'string',
      created_at: 'string',
      updated_at: 'string'
    });

    await seedTable('services', 'services.csv', {
      id: 'string',
      provider_id: 'string',
      category_id: 'string',
      title: 'string',
      slug: 'string',
      description: 'text',
      short_description: 'text',
      base_price_cents: 'integer',
      pricing_type: 'string',
      duration_minutes: 'integer',
      images: 'text',
      includes: 'text',
      why_choose: 'text',
      is_active: 'string',
      is_verified: 'string',
      is_featured: 'string',
      is_deleted: 'string',
      rating: 'float',
      total_reviews: 'integer',
      total_bookings: 'integer',
      verified_hours: 'integer',
      created_at: 'string',
      updated_at: 'string',
      duration_days: 'integer',
      duration_hours: 'integer',
      total_duration_minutes: 'integer',
      advance_payment_percentage: 'integer',
      isRejected: 'string',
      max_booking_hours: 'integer',
      max_parallel_bookings: 'integer',
      milestones: 'text',
      min_booking_hours: 'integer',
      rejectedAt: 'string',
      rejectionNote: 'text',
      service_location: 'string',
      excludes: 'text',
      platform_fee_percentage: 'float'
    });

    console.log('Seed completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
}

run();
