require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Property = require('./models/Property');
const Setting = require('./models/Setting');

async function seed() {
  try {
    const uri = process.env.MONGODB_URI;
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(uri);
    console.log('Connected to MongoDB successfully!');

    // Read ward_01_data.json
    let jsonPath = path.join(__dirname, 'data/ward_01_data.json');
    if (!fs.existsSync(jsonPath)) {
      jsonPath = path.join(__dirname, '../ward_01_data.json');
    }
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`Data file not found at: ${jsonPath}`);
    }
    const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    console.log(`Found ${rawData.length} records to seed.`);

    // Clear existing
    await Property.deleteMany({});
    console.log('Cleared existing properties collection.');

    // Format records
    const formatted = rawData.map(r => ({
      sr_no: Number(r.sr_no) || 0,
      property_id: String(r.property_id || '').trim(),
      house_no: String(r.house_no || '').trim(),
      owner_name: String(r.owner_name || 'AGYAT').trim().toUpperCase(),
      father_name: String(r.father_name || 'AGYAT').trim().toUpperCase(),
      mobile: String(r.mobile || '0').trim(),
      house_type: String(r.house_type || 'Residential').trim(),
      nirman: String(r.nirman || 'Pakka').trim(),
      road_width: String(r.road_width || '0 To 09').trim(),
      total_area: Number(r.total_area) || 0,
      covered_area: Number(r.covered_area) || 0,
      business_area: Number(r.business_area) || 0,
      plot_area: Number(r.plot_area) || 0,
      house_tax_rate: Number(r.house_tax_rate) || 0.40,
      plot_tax_rate: Number(r.plot_tax_rate) || 0.10,
      commercial_tax_rate: 1.00,
      discount_percent: 20,
      tax_percent: 10,
      total_arv: Number(r.total_arv) || 0,
      res_tax: Number(r.res_tax) || 0,
      com_tax: Number(r.com_tax) || 0,
      plot_tax: Number(r.plot_tax) || 0,
      total_tax: Number(r.total_tax) || 0
    }));

    await Property.insertMany(formatted);
    console.log(`Successfully seeded ${formatted.length} properties to MongoDB Atlas!`);

    // Ensure default settings
    const existingSetting = await Setting.findOne();
    if (!existingSetting) {
      await Setting.create({});
      console.log('Created initial default settings.');
    }

    await mongoose.disconnect();
    console.log('Database disconnected cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
