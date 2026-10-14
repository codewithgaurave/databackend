const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema({
  ward_name: { type: String, default: 'वार्ड 01 - अध्यक्ष' },
  palika_name: { type: String, default: 'कार्यालय नगर पालिका परिषद / नगर पंचायत' },
  financial_year: { type: String, default: '2026-2027' },
  pakka_rate: { type: Number, default: 0.40 },
  ardh_pakka_rate: { type: Number, default: 0.30 },
  kachcha_rate: { type: Number, default: 0.25 },
  plot_rate: { type: Number, default: 0.10 },
  commercial_rate: { type: Number, default: 1.00 },
  default_discount_percent: { type: Number, default: 20 },
  default_tax_percent: { type: Number, default: 10 },
  id_prefix: { type: String, default: '09037010010' },
  sticky_road_width: { type: String, default: '0 To 09' },
  sticky_nirman: { type: String, default: 'Pakka' },
  sticky_house_type: { type: String, default: 'Residential' }
}, {
  timestamps: true
});

module.exports = mongoose.model('Setting', SettingSchema);
