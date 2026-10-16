require('dotenv').config();
const mongoose = require('mongoose');
const Property = require('./models/Property');
const Ward = require('./models/Ward');

async function recalculate() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB successfully!');

    const properties = await Property.find({});
    console.log(`Found ${properties.length} total properties.`);

    let updatedCount = 0;
    for (const p of properties) {
      const type = (p.house_type || 'Residential').trim().toLowerCase();
      const arv = Number(p.total_arv) || 0;
      let changed = false;

      let newResTax = Number(p.res_tax) || 0;
      let newComTax = Number(p.com_tax) || 0;
      let newPlotTax = Number(p.plot_tax) || 0;

      if (type === 'commercial') {
        // Commercial: 20% of ARV (दोगुना - 2x)
        const targetComTax = Math.round(arv * 0.20);
        newComTax = targetComTax;
        newResTax = 0;
        changed = true;
      } else if (type === 'government') {
        // Government: 30% of ARV (तीन गुना - 3x)
        const targetGovTax = Math.round(arv * 0.30);
        newResTax = targetGovTax;
        newComTax = 0;
        changed = true;
      } else if (type === 'mixed') {
        // Mixed: business portion at 20% (दोगुना)
        // If business_area > 0 and commercial_tax_rate is set
        const bArea = Number(p.business_area) || 0;
        const discountMult = Math.max(0, 1 - ((Number(p.discount_percent) || 20) / 100));
        const comRate = Number(p.commercial_tax_rate) || 1.0;
        const bARV = Math.round(bArea * discountMult * comRate * 12);
        
        if (bARV > 0) {
          newComTax = Math.round(bARV * 0.20); // 20% दोगुना
        } else if (p.com_tax > 0) {
          newComTax = Math.round(p.com_tax * 2);
        }
        changed = true;
      }

      if (changed) {
        const houseTax = newResTax + newComTax + newPlotTax;
        const waterTax = p.has_water_tax ? (Number(p.water_tax) || Math.round(arv * 0.075)) : 0;
        const sewerTax = p.has_sewer_tax ? (Number(p.sewer_tax) || Math.round(arv * 0.025)) : 0;
        const totalTax = houseTax + waterTax + sewerTax;

        p.res_tax = newResTax;
        p.com_tax = newComTax;
        p.plot_tax = newPlotTax;
        p.house_tax = houseTax;
        p.water_tax = waterTax;
        p.sewer_tax = sewerTax;
        p.total_tax = totalTax;

        await p.save();
        updatedCount++;
      }
    }

    console.log(`Successfully recalculated and updated ${updatedCount} properties in MongoDB Atlas!`);

    // Update Ward aggregate stats
    const wards = await Ward.find({});
    for (const w of wards) {
      const stats = await Property.aggregate([
        { $match: { ward_no: w.ward_no } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalTax: { $sum: '$total_tax' },
            totalARV: { $sum: '$total_arv' }
          }
        }
      ]);
      if (stats.length > 0) {
        w.property_count = stats[0].count;
        w.total_tax = stats[0].totalTax;
        w.total_arv = stats[0].totalARV;
        await w.save();
        console.log(`Updated Ward ${w.ward_no} stats: ${w.property_count} properties, Total Tax: ₹${w.total_tax}`);
      }
    }

    await mongoose.disconnect();
    console.log('Database disconnected cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('Recalculation error:', err);
    process.exit(1);
  }
}

recalculate();
