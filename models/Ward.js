const mongoose = require('mongoose');

const WardSchema = new mongoose.Schema({
  ward_no: { 
    type: Number, 
    required: true, 
    unique: true, 
    index: true 
  },
  ward_name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  id_prefix: { 
    type: String, 
    default: '09037010010',
    trim: true 
  },
  parshad_name: { 
    type: String, 
    default: '', 
    trim: true 
  },
  contact_no: { 
    type: String, 
    default: '', 
    trim: true 
  },
  description: { 
    type: String, 
    default: '', 
    trim: true 
  },
  active: { 
    type: Boolean, 
    default: true 
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Ward', WardSchema);
