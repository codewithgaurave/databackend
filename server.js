const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const Property = require('./models/Property');
const Setting = require('./models/Setting');
const User = require('./models/User');
const Ward = require('./models/Ward');

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'nagar_palika_ward01_tax_portal_jwt_secure_secret_key_2026';

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Seed Default Users if none exist
async function seedDefaultUsers() {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      console.log('🌱 Seeding initial system users...');
      const adminPass = await User.hashPassword('admin123');
      const collectorPass = await User.hashPassword('tax123');
      const adhyakshPass = await User.hashPassword('ward123');

      await User.create([
        {
          username: 'admin',
          password: adminPass,
          name: 'श्री राजेश कुमार (प्रभारी)',
          role: 'admin',
          designation: 'अधिशासी अधिकारी / EO (Admin)',
          mobile: '9839000001'
        },
        {
          username: 'collector',
          password: collectorPass,
          name: 'अमित कुमार वर्मा',
          role: 'operator',
          designation: 'कर संग्राहक (Tax Collector)',
          mobile: '9839000002'
        },
        {
          username: 'adhyaksh',
          password: adhyakshPass,
          name: 'वार्ड प्रतिनिधि (अध्यक्ष)',
          role: 'viewer',
          designation: 'वार्ड अध्यक्ष (Ward Representative)',
          mobile: '9839000003'
        }
      ]);
      console.log('✅ Default users initialized: admin, collector, adhyaksh');
    }
  } catch (err) {
    console.error('Error seeding users:', err);
  }
}

// Initialize Wards and Backfill Properties
async function initializeWardsAndProperties() {
  try {
    const wardCount = await Ward.countDocuments();
    if (wardCount === 0) {
      console.log('🌱 Seeding initial default Ward 01...');
      await Ward.create({
        ward_no: 1,
        ward_name: 'वार्ड 01 - अध्यक्ष',
        id_prefix: '09037010010',
        parshad_name: 'वार्ड अध्यक्ष',
        contact_no: '9839000003',
        description: 'प्रथम वार्ड (अध्यक्ष)'
      });
      console.log('✅ Default Ward 01 initialized');
    }

    // Backfill any properties missing ward_no
    const backfilled = await Property.updateMany(
      { $or: [{ ward_no: { $exists: false } }, { ward_no: null }] },
      { $set: { ward_no: 1, ward_name: 'वार्ड 01 - अध्यक्ष' } }
    );
    if (backfilled.modifiedCount > 0) {
      console.log(`✅ Backfilled ${backfilled.modifiedCount} existing properties to Ward 01`);
    }
  } catch (err) {
    console.error('Error initializing wards:', err);
  }
}

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB Atlas Connected Successfully on Port', PORT);
    seedDefaultUsers();
    initializeWardsAndProperties();
  })
  .catch(err => console.error('MongoDB Connection Error:', err));

// --- AUTH MIDDLEWARE ---
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'अनधिकृत: कृपया पहले लॉगिन करें।' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.active) {
      return res.status(401).json({ error: 'उपयोगकर्ता खाता अमान्य या निष्क्रिय है।' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'सत्र समाप्त या अमान्य टोकन, कृपया पुनः लॉगिन करें।' });
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'इस कार्य के लिए आपके पास अधिकार (Permission) नहीं है।' });
    }
    next();
  };
};

// --- CALCULATION HELPER ---
function computeTax(input) {
  const totalLength = Math.max(0, Number(input.total_length) || 0);
  const totalWidth = Math.max(0, Number(input.total_width) || 0);
  let totalArea = Math.max(0, Number(input.total_area) || 0);
  if (totalLength > 0 && totalWidth > 0 && !input.total_area) {
    totalArea = Math.round(totalLength * totalWidth);
  }

  const coveredLength = Math.max(0, Number(input.covered_length) || 0);
  const coveredWidth = Math.max(0, Number(input.covered_width) || 0);
  let coveredArea = Math.max(0, Number(input.covered_area) || 0);
  if (coveredLength > 0 && coveredWidth > 0 && !input.covered_area) {
    coveredArea = Math.round(coveredLength * coveredWidth);
  }

  const businessArea = Math.max(0, Number(input.business_area) || 0);
  const plotArea = Math.max(0, Number(input.plot_area !== undefined ? input.plot_area : (totalArea - coveredArea)) || 0);

  const houseRate = Number(input.house_tax_rate) || 0.40;
  const plotRate = Number(input.plot_tax_rate) || 0.10;
  const comRate = Number(input.commercial_tax_rate) || 1.00;

  const discountPct = Number(input.discount_percent !== undefined ? input.discount_percent : 20);
  const taxPct = Number(input.tax_percent !== undefined ? input.tax_percent : 10);

  const discountMultiplier = Math.max(0, 1 - (discountPct / 100));
  const residentialArea = Math.max(0, coveredArea - businessArea);

  const resARV = Math.round(residentialArea * discountMultiplier * houseRate * 12);
  const comARV = Math.round(businessArea * discountMultiplier * comRate * 12);
  const plotARV = Math.round(plotArea * discountMultiplier * plotRate * 12);

  const totalARV = resARV + comARV + plotARV;

  const houseTypeLower = String(input.house_type || 'Residential').trim().toLowerCase();

  let resTax = 0;
  let comTax = 0;
  let plotTax = Math.round(plotARV * (taxPct / 100));

  if (houseTypeLower === 'commercial') {
    // Commercial property: 2x (दोगुना) -> 20%
    const commercialCoveredARV = resARV + comARV;
    comTax = Math.round(commercialCoveredARV * ((taxPct * 2) / 100));
    resTax = 0;
  } else if (houseTypeLower === 'government') {
    // Government property: 3x (तीन गुना) -> 30%
    const govtCoveredARV = resARV + comARV;
    resTax = Math.round(govtCoveredARV * ((taxPct * 3) / 100));
    comTax = 0;
  } else if (houseTypeLower === 'mixed') {
    // Mixed property: Residential part at 10%, Commercial/business part at 20% (दोगुना)
    resTax = Math.round(resARV * (taxPct / 100));
    comTax = Math.round(comARV * ((taxPct * 2) / 100));
  } else {
    // Residential / Plot: 10%
    resTax = Math.round(resARV * (taxPct / 100));
    comTax = Math.round(comARV * (taxPct / 100));
  }

  const houseTax = resTax + comTax + plotTax;

  // Water Tax (7.5%) & Sewer Tax (2.5%)
  const hasWaterTax = Boolean(input.has_water_tax);
  const waterTaxPercent = Number(input.water_tax_percent !== undefined ? input.water_tax_percent : 7.5);
  const waterTax = hasWaterTax ? Math.round(totalARV * (waterTaxPercent / 100)) : 0;

  const hasSewerTax = Boolean(input.has_sewer_tax);
  const sewerTaxPercent = Number(input.sewer_tax_percent !== undefined ? input.sewer_tax_percent : 2.5);
  const sewerTax = hasSewerTax ? Math.round(totalARV * (sewerTaxPercent / 100)) : 0;

  const totalTax = houseTax + waterTax + sewerTax;

  return {
    total_length: totalLength,
    total_width: totalWidth,
    total_area: totalArea,
    covered_length: coveredLength,
    covered_width: coveredWidth,
    covered_area: coveredArea,
    business_area: businessArea,
    plot_area: plotArea,
    house_tax_rate: houseRate,
    plot_tax_rate: plotRate,
    commercial_tax_rate: comRate,
    discount_percent: discountPct,
    tax_percent: taxPct,
    total_arv: totalARV,
    res_tax: resTax,
    com_tax: comTax,
    plot_tax: plotTax,
    house_tax: houseTax,
    has_water_tax: hasWaterTax,
    water_tax_percent: waterTaxPercent,
    water_tax: waterTax,
    has_sewer_tax: hasSewerTax,
    sewer_tax_percent: sewerTaxPercent,
    sewer_tax: sewerTax,
    total_tax: totalTax
  };
}

// --- ROUTES ---

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Dashboard Statistics
app.get('/api/stats', async (req, res) => {
  try {
    const { ward_no } = req.query;
    const filter = (ward_no && ward_no !== 'all') ? { ward_no: Number(ward_no) } : {};

    const totalCount = await Property.countDocuments(filter);
    
    const [totals] = await Property.aggregate([
      ...(Object.keys(filter).length ? [{ $match: filter }] : []),
      {
        $group: {
          _id: null,
          totalTax: { $sum: '$total_tax' },
          totalARV: { $sum: '$total_arv' },
          totalResTax: { $sum: '$res_tax' },
          totalComTax: { $sum: '$com_tax' },
          totalPlotTax: { $sum: '$plot_tax' }
        }
      }
    ]);

    const typeBreakdown = await Property.aggregate([
      ...(Object.keys(filter).length ? [{ $match: filter }] : []),
      {
        $group: {
          _id: '$house_type',
          count: { $sum: 1 },
          totalTax: { $sum: '$total_tax' },
          totalARV: { $sum: '$total_arv' }
        }
      }
    ]);

    const topAssessments = await Property.find(filter)
      .sort({ total_tax: -1 })
      .limit(8)
      .lean();

    res.json({
      ward_no: ward_no || 'all',
      totalCount,
      totalTax: totals?.totalTax || 0,
      totalARV: totals?.totalARV || 0,
      totalResTax: totals?.totalResTax || 0,
      totalComTax: totals?.totalComTax || 0,
      totalPlotTax: totals?.totalPlotTax || 0,
      typeBreakdown,
      topAssessments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Next Available IDs
app.get('/api/next-id', async (req, res) => {
  try {
    const { ward_no, house_type = 'Residential' } = req.query;
    const targetWardNo = ward_no && ward_no !== 'all' ? Number(ward_no) : 1;

    // Find target ward for prefix
    const wardDoc = await Ward.findOne({ ward_no: targetWardNo }).lean();
    const setting = await Setting.findOne().lean() || {};

    let prefix = wardDoc?.id_prefix;
    if (!prefix) {
      prefix = setting.id_prefix || `090370${String(targetWardNo).padStart(2, '0')}0010`;
    }

    const lastBySr = await Property.findOne().sort({ sr_no: -1 }).lean();
    const nextSr = (lastBySr?.sr_no || 0) + 1;

    // Find highest house number in this ward
    const wardProps = await Property.find({ ward_no: targetWardNo }, { house_no: 1 }).lean();
    let maxHouse = 10000;
    if (wardProps.length > 0) {
      wardProps.forEach(p => {
        const match = String(p.house_no).match(/\d+/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (num > maxHouse && num < 99999) maxHouse = num;
        }
      });
    }

    const nextHouse = maxHouse + 1;

    // Type suffix mapping: Residential -> R, Commercial -> C, Mixed -> M, Plot -> P, Government -> G
    const typeSuffixMap = {
      'Residential': 'R',
      'Commercial': 'C',
      'Mixed': 'M',
      'Plot': 'P',
      'Government': 'G'
    };
    const suffix = typeSuffixMap[house_type] || 'R';

    // Format: Exactly 16 digits + 1 special letter = 17 characters
    let cleanPrefix = String(prefix).replace(/\D/g, '');
    if (cleanPrefix.length < 11) {
      cleanPrefix = cleanPrefix.padEnd(11, '0');
    } else if (cleanPrefix.length > 11) {
      cleanPrefix = cleanPrefix.slice(0, 11);
    }
    const padHouse = String(nextHouse).padStart(5, '0');
    const nextPropId = `${cleanPrefix}${padHouse}${suffix}`;

    res.json({
      ward_no: targetWardNo,
      ward_name: wardDoc?.ward_name || `वार्ड ${String(targetWardNo).padStart(2, '0')}`,
      nextSr,
      nextHouse: String(nextHouse),
      nextPropId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List Properties with Search, Filter & Pagination
app.get('/api/properties', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      search = '',
      house_type = '',
      nirman = '',
      ward_no = '',
      sort_by = 'sr_no',
      sort_order = 'asc'
    } = req.query;

    const query = {};

    if (ward_no && ward_no !== 'all') {
      const parsedWard = parseInt(ward_no, 10);
      if (!isNaN(parsedWard)) {
        query.ward_no = parsedWard;
      }
    }
    if (house_type) {
      query.house_type = new RegExp('^' + house_type.trim() + '$', 'i');
    }
    if (nirman) {
      query.nirman = new RegExp('^' + nirman.trim() + '$', 'i');
    }

    if (search && search.trim()) {
      const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(safeSearch, 'i');
      query.$or = [
        { owner_name: regex },
        { father_name: regex },
        { property_id: regex },
        { house_no: regex },
        { mobile: regex }
      ];
    }

    const sort = {};
    const sortField = sort_by || 'sr_no';
    sort[sortField] = sort_order === 'desc' ? -1 : 1;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = limit === 'all' ? 10000 : Math.max(1, parseInt(limit, 10) || 25);
    const skip = (pageNum - 1) * limitNum;

    const [total, items] = await Promise.all([
      Property.countDocuments(query),
      Property.find(query).sort(sort).skip(skip).limit(limitNum).lean()
    ]);

    res.json({
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multi-Property Owner Search
app.get('/api/owners/search', async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (!q || !q.trim()) return res.json({ groups: [] });

    const safeQ = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(safeQ, 'i');
    const matched = await Property.find({
      $or: [
        { owner_name: regex },
        { father_name: regex },
        { mobile: regex }
      ]
    }).sort({ sr_no: 1 }).lean();

    // Group by owner_name
    const map = {};
    matched.forEach(p => {
      const name = p.owner_name || 'AGYAT';
      if (!map[name]) {
        map[name] = {
          owner_name: name,
          father_name: p.father_name,
          mobile: p.mobile,
          properties: [],
          totalTax: 0,
          totalArea: 0,
          totalARV: 0
        };
      }
      map[name].properties.push(p);
      map[name].totalTax += p.total_tax || 0;
      map[name].totalArea += p.total_area || 0;
      map[name].totalARV += p.total_arv || 0;
    });

    res.json({ groups: Object.values(map) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Single Property
app.get('/api/properties/:id', async (req, res) => {
  try {
    const item = await Property.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Property not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create New Property
app.post('/api/properties', async (req, res) => {
  try {
    const body = req.body;

    // Auto-calculate tax
    const calc = computeTax(body);

    // Get next Sr No if not provided
    let srNo = Number(body.sr_no);
    if (!srNo) {
      const last = await Property.findOne().sort({ sr_no: -1 }).lean();
      srNo = (last?.sr_no || 0) + 1;
    }

    // Determine ward
    let wardNo = Number(body.ward_no) || 1;
    let wardName = body.ward_name;
    if (!wardName) {
      const targetWard = await Ward.findOne({ ward_no: wardNo }).lean();
      wardName = targetWard?.ward_name || `वार्ड ${String(wardNo).padStart(2, '0')}`;
    }

    const doc = new Property({
      ...body,
      ...calc,
      ward_no: wardNo,
      ward_name: wardName,
      sr_no: srNo,
      owner_name: String(body.owner_name || '').trim().toUpperCase(),
      father_name: String(body.father_name || '').trim().toUpperCase(),
      property_id: String(body.property_id || '').trim()
    });

    const saved = await doc.save();

    // Update sticky values in Settings
    if (body.road_width || body.nirman || body.house_type) {
      await Setting.findOneAndUpdate({}, {
        sticky_road_width: body.road_width || '0 To 09',
        sticky_nirman: body.nirman || 'Pakka',
        sticky_house_type: body.house_type || 'Residential'
      });
    }

    res.status(201).json(saved);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'इस प्रॉपर्टी आईडी का रिकॉर्ड पहले से मौजूद है।' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update Property
app.put('/api/properties/:id', async (req, res) => {
  try {
    const body = req.body;
    const calc = computeTax(body);

    const updated = await Property.findByIdAndUpdate(
      req.params.id,
      {
        ...body,
        ...calc,
        owner_name: String(body.owner_name || '').trim().toUpperCase(),
        father_name: String(body.father_name || '').trim().toUpperCase()
      },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ error: 'Property not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Property
app.delete('/api/properties/:id', async (req, res) => {
  try {
    const deleted = await Property.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Property not found' });
    res.json({ message: 'Property deleted successfully', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings Endpoints
app.get('/api/settings', async (req, res) => {
  try {
    let setting = await Setting.findOne();
    if (!setting) {
      setting = await Setting.create({});
    }
    res.json(setting);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const updated = await Setting.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- WARD MANAGEMENT ENDPOINTS ---

// 1. List All Wards with Stats
app.get('/api/wards', async (req, res) => {
  try {
    const wards = await Ward.find().sort({ ward_no: 1 }).lean();
    
    // Aggregated stats per ward
    const stats = await Property.aggregate([
      {
        $group: {
          _id: '$ward_no',
          property_count: { $sum: 1 },
          total_tax: { $sum: '$total_tax' },
          total_arv: { $sum: '$total_arv' }
        }
      }
    ]);

    const statsMap = {};
    stats.forEach(s => {
      statsMap[s._id] = {
        count: s.property_count,
        totalTax: s.total_tax,
        totalARV: s.total_arv
      };
    });

    const result = wards.map(w => ({
      ...w,
      property_count: statsMap[w.ward_no]?.count || 0,
      total_tax: statsMap[w.ward_no]?.totalTax || 0,
      total_arv: statsMap[w.ward_no]?.totalARV || 0
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create New Ward (Admin Only)
app.post('/api/wards', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { ward_no, ward_name, id_prefix, parshad_name, contact_no, description } = req.body;
    
    if (!ward_no || !ward_name) {
      return res.status(400).json({ error: 'वार्ड संख्या एवं वार्ड का नाम अनिवार्य हैं।' });
    }

    const num = Number(ward_no);
    if (isNaN(num) || num <= 0) {
      return res.status(400).json({ error: 'मान्य वार्ड संख्या दर्ज करें (जैसे 1, 2, 3...)।' });
    }

    const existing = await Ward.findOne({ ward_no: num });
    if (existing) {
      return res.status(400).json({ error: `वार्ड संख्या ${num} पहले से मौजूद है (${existing.ward_name})।` });
    }

    const padNo = String(num).padStart(2, '0');
    const defaultPrefix = id_prefix ? id_prefix.trim() : `090370${padNo}0010`;

    const newWard = await Ward.create({
      ward_no: num,
      ward_name: ward_name.trim(),
      id_prefix: defaultPrefix,
      parshad_name: parshad_name ? parshad_name.trim() : '',
      contact_no: contact_no ? contact_no.trim() : '',
      description: description ? description.trim() : ''
    });

    res.status(201).json(newWard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Update Ward (Admin Only)
app.put('/api/wards/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { ward_name, id_prefix, parshad_name, contact_no, description, active } = req.body;
    
    const ward = await Ward.findById(req.params.id);
    if (!ward) return res.status(404).json({ error: 'वार्ड नहीं मिला।' });

    const oldName = ward.ward_name;
    if (ward_name) ward.ward_name = ward_name.trim();
    if (id_prefix) ward.id_prefix = id_prefix.trim();
    if (parshad_name !== undefined) ward.parshad_name = parshad_name.trim();
    if (contact_no !== undefined) ward.contact_no = contact_no.trim();
    if (description !== undefined) ward.description = description.trim();
    if (active !== undefined) ward.active = Boolean(active);

    await ward.save();

    // If ward name changed, sync all properties with this ward_no
    if (ward_name && ward_name.trim() !== oldName) {
      await Property.updateMany(
        { ward_no: ward.ward_no },
        { $set: { ward_name: ward_name.trim() } }
      );
    }

    res.json(ward);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete Ward (Admin Only)
app.delete('/api/wards/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const ward = await Ward.findById(req.params.id);
    if (!ward) return res.status(404).json({ error: 'वार्ड नहीं मिला।' });

    // Check if properties exist in this ward
    const propCount = await Property.countDocuments({ ward_no: ward.ward_no });
    if (propCount > 0) {
      return res.status(400).json({ 
        error: `इस वार्ड में कुल ${propCount} संपत्तियां दर्ज हैं। सुरक्षा कारणों से इसे हटाया नहीं जा सकता।` 
      });
    }

    await Ward.findByIdAndDelete(req.params.id);
    res.json({ message: `वार्ड "${ward.ward_name}" सफलतापूर्वक हटा दिया गया है।` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AUTHENTICATION ENDPOINTS ---

// 1. User Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'कृपया यूजरनेम और पासवर्ड दोनों दर्ज करें।' });
    }

    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: 'यूजरनेम अमान्य है। कृपया सही विवरण भरें।' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'यह खाता निष्क्रिय (Inactive) कर दिया गया है। एडमिन से संपर्क करें।' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'गलत पासवर्ड! कृपया पुनः प्रयास करें।' });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
        designation: user.designation,
        mobile: user.mobile,
        lastLogin: user.lastLogin
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Current Authenticated User
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  res.json({ user: req.user });
});

// 3. Change Password
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'कृपया वर्तमान एवं नया पासवर्ड भरें।' });
    }
    if (newPassword.length < 5) {
      return res.status(400).json({ error: 'नया पासवर्ड कम से कम 5 अक्षरों का होना चाहिए।' });
    }

    const user = await User.findById(req.user._id);
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ error: 'वर्तमान पासवर्ड सही नहीं है।' });
    }

    user.password = await User.hashPassword(newPassword);
    await user.save();
    res.json({ message: 'पासवर्ड सफलतापूर्वक बदल दिया गया है!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. List All Users (Admin Only)
app.get('/api/auth/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Create New User (Admin Only)
app.post('/api/auth/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, name, role, designation, mobile } = req.body;
    if (!username || !password || !name) {
      return res.status(400).json({ error: 'यूजरनेम, पासवर्ड एवं नाम अनिवार्य हैं।' });
    }

    const cleanUsername = username.toLowerCase().trim();
    const existing = await User.findOne({ username: cleanUsername });
    if (existing) {
      return res.status(400).json({ error: 'यह यूजरनेम पहले से किसी अन्य कर्मचारी के नाम दर्ज है।' });
    }

    const hashedPassword = await User.hashPassword(password);
    const newUser = await User.create({
      username: cleanUsername,
      password: hashedPassword,
      name: name.trim(),
      role: role || 'operator',
      designation: designation ? designation.trim() : (role === 'admin' ? 'अधिशासी अधिकारी' : 'कर संग्राहक'),
      mobile: mobile ? mobile.trim() : ''
    });

    res.status(201).json({
      id: newUser._id,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
      designation: newUser.designation,
      mobile: newUser.mobile
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Delete User (Admin Only)
app.delete('/api/auth/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    if (String(req.user._id) === String(req.params.id)) {
      return res.status(400).json({ error: 'आप स्वयं अपना एडमिन खाता डिलीट नहीं कर सकते।' });
    }
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'उपयोगकर्ता नहीं मिला।' });
    res.json({ message: 'उपयोगकर्ता खाता सफलतापूर्वक हटा दिया गया।' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Root / SPA Fallback
app.get('*', (req, res) => {
  const distPath = path.join(__dirname, '../frontend/dist/index.html');
  if (fs.existsSync(distPath)) {
    res.sendFile(distPath);
  } else {
    res.json({
      status: 'online',
      service: 'Ward 01 House Tax Management Backend API',
      message: 'नगर पालिका डिजिटल गृहकर बैकएंड API सफलतापूर्वक संचालित है।',
      timestamp: new Date().toISOString()
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
