const mongoose = require('mongoose');

const PropertySchema = new mongoose.Schema({
  sr_no: { type: Number, required: true, index: true },
  property_id: { type: String, required: true, unique: true, index: true },
  house_no: { type: String, required: true, index: true },
  owner_name: { type: String, required: true, index: true },
  father_name: { type: String, default: 'AGYAT' },
  mobile: { type: String, default: '0' },
  house_type: { 
    type: String, 
    enum: ['Residential', 'Commercial', 'Mixed', 'Plot', 'Government'],
    default: 'Residential' 
  },
  nirman: { 
    type: String, 
    enum: ['Pakka', 'Ardh Pakka', 'Kachcha', 'Plot'],
    default: 'Pakka' 
  },
  road_width: { type: String, default: '0 To 09' },
  total_area: { type: Number, default: 0 },
  covered_area: { type: Number, default: 0 },
  business_area: { type: Number, default: 0 },
  plot_area: { type: Number, default: 0 },
  house_tax_rate: { type: Number, default: 0.40 },
  plot_tax_rate: { type: Number, default: 0.10 },
  commercial_tax_rate: { type: Number, default: 1.00 },
  discount_percent: { type: Number, default: 20 },
  tax_percent: { type: Number, default: 10 },
  total_arv: { type: Number, default: 0 },
  res_tax: { type: Number, default: 0 },
  com_tax: { type: Number, default: 0 },
  plot_tax: { type: Number, default: 0 },
  total_tax: { type: Number, default: 0 }
}, {
  timestamps: true
});

// Full-text search index
PropertySchema.index({
  owner_name: 'text',
  father_name: 'text',
  property_id: 'text',
  house_no: 'text',
  mobile: 'text'
});

module.exports = mongoose.model('Property', PropertySchema);
