import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema({
  number: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, trim: true, default: '' }, model: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true }, year: { type: String, default: '' },
  ownerName: { type: String, default: '' }, registrationDate: String, fitnessValid: String,
  taxValid: String, insurance: String, pucc: String, oil: String, grease: String, permit: String, nationalPermit: String,
  capacity: { type: String, default: '' }, odometer: { type: String, default: '' },
  location: { type: String, default: 'Not recorded' }, status: { type: String, default: 'Available' },
  driver: { type: String, default: 'Unassigned' }, phone: { type: String, default: '' },
}, { timestamps: true });
vehicleSchema.index({ number: 1 }, { unique: true });

const driverSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, phone: { type: String, required: true, trim: true },
  vehicleNumber: { type: String, default: '' },
}, { timestamps: true });
driverSchema.index({ phone: 1 }, { unique: true });

const expenseSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0.01 }, reason: { type: String, required: true, trim: true }, date: { type: Date, default: Date.now },
}, { _id: true });
const tripSchema = new mongoose.Schema({
  date: { type: String, required: true }, paidDate: { type: String, default: '' }, challan: { type: String, default: '—' },
  vehicle: { type: String, required: true, trim: true, uppercase: true },
  transporter: { type: String, required: true, trim: true }, party: { type: String, required: true, trim: true },
  loading: { type: String, required: true, trim: true }, unloading: { type: String, required: true, trim: true },
  material: { type: String, required: true, trim: true }, weight: { type: Number, required: true, min: 0.01 },
  rate: { type: Number, required: true, min: 0 }, amount: { type: Number, required: true, min: 0 },
  advance: { type: Number, default: 0, min: 0 }, balance: { type: Number, required: true, min: 0 },
  driver: { type: String, default: '' }, status: { type: String, enum: ['Scheduled', 'In transit', 'Completed', 'Delayed'], default: 'Scheduled' },
  expenses: { type: [expenseSchema], default: [] },
}, { timestamps: true });
tripSchema.index({ vehicle: 1, date: -1 });
tripSchema.index({ date: -1 });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false }, role: { type: String, enum: ['admin'], default: 'admin' },
}, { timestamps: true });

export const Vehicle = mongoose.model('Vehicle', vehicleSchema);
export const Driver = mongoose.model('Driver', driverSchema);
export const Trip = mongoose.model('Trip', tripSchema);
export const User = mongoose.model('User', userSchema);
