const mongoose = require('mongoose');

const PropertySchema = new mongoose.Schema({
  ward_no: { type: Number, default: 1, index: true },
  ward_name: { type: String, default: 'वार्ड 01 - अध्यक्ष', index: true },
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
  road_width: { type: String, default: '0 से 9 मीटर' },
  total_length: { type: Number, default: 0 },
  total_width: { type: Number, default: 0 },
  total_area: { type: Number, default: 0 },
  covered_length: { type: Number, default: 0 },
  covered_width: { type: Number, default: 0 },
  covered_area: { type: Number, default: 0 },
  res_covered_area: { type: Number, default: 0 },
  floors_count: { type: Number, default: 1 },
  floors_data: { type: Array, default: [] },
  business_length: { type: Number, default: 0 },
  business_width: { type: Number, default: 0 },
  business_area: { type: Number, default: 0 },
  plot_length: { type: Number, default: 0 },
  plot_width: { type: Number, default: 0 },
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
  house_tax: { type: Number, default: 0 },
  has_water_tax: { type: Boolean, default: false },
  water_tax_percent: { type: Number, default: 7.5 },
  water_tax: { type: Number, default: 0 },
  has_sewer_tax: { type: Boolean, default: false },
  sewer_tax_percent: { type: Number, default: 2.5 },
  sewer_tax: { type: Number, default: 0 },
  // Rule 7(5) Non-Residential Incentives / Rebates (अनावासीय प्रोत्साहन छूट - 2% प्रत्येक)
  rebate_rainwater: { type: Boolean, default: false },
  rebate_greenery: { type: Boolean, default: false },
  rebate_parking: { type: Boolean, default: false },
  rebate_pollution: { type: Boolean, default: false },
  rebate_percent: { type: Number, default: 0 },
  rebate_amount: { type: Number, default: 0 },
  // Rule 7(3) Central Government Service Charge (भारत संघ / विभाग सेवा प्रभार)
  govt_service_type: { 
    type: String, 
    enum: ['tax_100', 'service_75', 'service_50', 'service_33'], 
    default: 'tax_100' 
  },
  govt_service_percent: { type: Number, default: 100 },
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
