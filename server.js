require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const Property = require('./models/Property');
const Setting = require('./models/Setting');
const User = require('./models/User');

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

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB Atlas Connected Successfully on Port', PORT);
    seedDefaultUsers();
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
  const totalArea = Math.max(0, Number(input.total_area) || 0);
  const coveredArea = Math.max(0, Number(input.covered_area) || 0);
  const businessArea = Math.max(0, Number(input.business_area) || 0);
  const plotArea = Math.max(0, Number(input.plot_area) || 0);

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

  const resTax = Math.round(resARV * (taxPct / 100));
  const comTax = Math.round(comARV * (taxPct / 100));
  const plotTax = Math.round(plotARV * (taxPct / 100));
  const totalTax = resTax + comTax + plotTax;

  return {
    total_area: totalArea,
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
    const totalCount = await Property.countDocuments();
    
    const [totals] = await Property.aggregate([
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
      {
        $group: {
          _id: '$house_type',
          count: { $sum: 1 },
          totalTax: { $sum: '$total_tax' },
          totalARV: { $sum: '$total_arv' }
        }
      }
    ]);

    const topAssessments = await Property.find()
      .sort({ total_tax: -1 })
      .limit(8)
      .lean();

    res.json({
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
    const setting = await Setting.findOne().lean() || {};
    const prefix = setting.id_prefix || '09037010010';

    const lastBySr = await Property.findOne().sort({ sr_no: -1 }).lean();
    const nextSr = (lastBySr?.sr_no || 0) + 1;

    // Find highest house number
    const allProps = await Property.find({}, { house_no: 1 }).lean();
    let maxHouse = 10000;
    allProps.forEach(p => {
      const match = String(p.house_no).match(/\d+/);
      if (match) {
        const num = parseInt(match[0], 10);
        if (num > maxHouse && num < 90000) maxHouse = num;
      }
    });

    const nextHouse = maxHouse + 1;
    const nextPropId = `${prefix}01${nextHouse}R`;

    res.json({
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
      sort_by = 'sr_no',
      sort_order = 'asc'
    } = req.query;

    const query = {};

    if (house_type) query.house_type = house_type;
    if (nirman) query.nirman = nirman;

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { owner_name: regex },
        { father_name: regex },
        { property_id: regex },
        { house_no: regex },
        { mobile: regex }
      ];
    }

    const sort = {};
    sort[sort_by] = sort_order === 'desc' ? -1 : 1;

    const pageNum = parseInt(page, 10);
    const limitNum = limit === 'all' ? 10000 : parseInt(limit, 10);
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
    if (!q) return res.json({ groups: [] });

    const regex = new RegExp(q.trim(), 'i');
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

    const doc = new Property({
      ...body,
      ...calc,
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
