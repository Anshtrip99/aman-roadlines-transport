import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Vehicle, Driver, Trip, User } from './models/index.js';
import { requireAuth, cookieOptions } from './middleware/auth.js';

export const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const clientDistPath = fileURLToPath(new URL('../public/', import.meta.url));
const money = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const serializeExpense = e => ({ id: String(e._id), amount: e.amount, reason: e.reason, date: e.date });
const normalizeTripDate = value => { const parts=String(value||'').trim().replaceAll('/','-').split('-'); if(parts.length!==3)return null; let year,month,day; if(parts[0].length===4)[year,month,day]=parts; else { [day,month,year]=parts; if(year.length===2)year='20'+year; } year=Number(year);month=Number(month);day=Number(day);const check=new Date(Date.UTC(year,month-1,day));if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)return null;return String(year)+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'); };
const normalizeChallan = value => { const raw=String(value||''); return [...raw].some(ch=>[195,226,65533].includes(ch.charCodeAt(0)))?'-':raw; };
const serializeTrip = t => ({ id: String(t._id), date: normalizeTripDate(t.date)||t.date, paidDate:normalizeTripDate(t.paidDate)||'', challan:normalizeChallan(t.challan), vehicle:t.vehicle, transporter:t.transporter, party:t.party, loading:t.loading, unloading:t.unloading, material:t.material, weight:Number(t.weight), rate:Number(t.rate), amount:Number(t.amount), advance:Number(t.advance), balance:Number(t.balance), driver:t.driver, status:t.status, expenses:t.expenses.map(serializeExpense) });
const serializeVehicle = v => ({ ...v.toObject(), id: String(v._id), number: v.number });
const serializeDriver = d => ({ id: String(d._id), name: d.name, phone: d.phone, vehicleNumber: d.vehicleNumber });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'style-src': ["'self'", 'https://fonts.googleapis.com'], 'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'] } } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
let connectionPromise = null;
export async function ensureDatabaseConnected() {
  if (mongoose.connection.readyState === 1) return;
  if (!process.env.MONGODB_URI || !process.env.JWT_SECRET || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error('Set MONGODB_URI, JWT_SECRET, ADMIN_EMAIL, and ADMIN_PASSWORD in the server environment.');
  }
  if (!connectionPromise) {
    connectionPromise = (async () => {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, bufferTimeoutMS: 8000, maxPoolSize: 5, minPoolSize: 0 });
      const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
      if (!await User.exists({ email })) {
        try { await User.create({ email, passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12) }); }
        catch (error) { if (error.code !== 11000) throw error; }
      }
    })();
  }
  try { await connectionPromise; }
  finally { connectionPromise = null; }
}
app.use(async (_req, _res, next) => {
  try { await ensureDatabaseConnected(); next(); }
  catch (error) { next(error); }
});
app.get('/api/health', (_req, res) => { const connected = mongoose.connection.readyState === 1; res.status(connected ? 200 : 503).json({ ok: connected, database: connected ? 'connected' : 'disconnected' }); });
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: 'Email or password is incorrect.' });
    const token = jwt.sign({ sub: String(user._id), email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.cookie('fleet_session', token, cookieOptions()).json({ user: { email: user.email, role: user.role } });
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', (_req, res) => res.clearCookie('fleet_session', cookieOptions()).json({ ok: true }));
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: { email: req.user.email, role: req.user.role } }));

app.use('/api', requireAuth);
app.get('/api/data', async (_req, res, next) => {
  try {
    const [vehicles, drivers, trips] = await Promise.all([Vehicle.find().sort({ number: 1 }), Driver.find().sort({ name: 1 }), Trip.find().sort({ date: -1, createdAt: -1 })]);
    res.json({ vehicles: vehicles.map(serializeVehicle), drivers: drivers.map(serializeDriver), trips: trips.map(serializeTrip) });
  } catch (error) { next(error); }
});
app.post('/api/data/import', async (req, res, next) => {
  try {
    const [vehicleCount, driverCount, tripCount] = await Promise.all([Vehicle.countDocuments(), Driver.countDocuments(), Trip.countDocuments()]);
    if (vehicleCount || driverCount || tripCount) return res.status(409).json({ message: 'Database already contains records; browser import was skipped.' });
    const data = req.body || {};
    const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
    const drivers = Array.isArray(data.drivers) ? data.drivers : [];
    const trips = Array.isArray(data.trips) ? data.trips : [];
    if (vehicles.length) await Vehicle.insertMany(vehicles.map(({ number, ...v }) => ({ ...v, number: String(number || '').trim().toUpperCase() })));
    if (drivers.length) await Driver.insertMany(drivers.map(d => ({ name: d.name, phone: d.phone, vehicleNumber: d.vehicleNumber || '' })));
    const parse = value => Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0;
    if (trips.length) await Trip.insertMany(trips.map(t => {
      const amount = parse(t.amount) || parse(t.weight) * parse(t.rate);
      const advance = parse(t.advance);
      return { date: normalizeTripDate(t.date)||t.date, paidDate: normalizeTripDate(t.paidDate)||'', challan: t.challan || '-', vehicle: String(t.vehicle || '').trim().toUpperCase(), transporter: t.transporter || 'Aman Roadlines', party: t.party, loading: t.loading, unloading: t.unloading, material: t.material || '', weight: parse(t.weight), rate: parse(t.rate), amount, advance, balance: Math.max(0, amount - advance), driver: t.driver || '', status: t.status || 'Scheduled', expenses: (t.expenses || []).map(e => ({ amount: parse(e.amount), reason: e.reason, date: e.date || new Date() })) };
    }));
    const [savedVehicles, savedDrivers, savedTrips] = await Promise.all([Vehicle.find().sort({ number: 1 }), Driver.find().sort({ name: 1 }), Trip.find().sort({ date: -1, createdAt: -1 })]);
    res.status(201).json({ vehicles: savedVehicles.map(serializeVehicle), drivers: savedDrivers.map(serializeDriver), trips: savedTrips.map(serializeTrip) });
  } catch (error) { next(error); }
});
app.post('/api/vehicles', async (req, res, next) => {
  try { const vehicle = await Vehicle.create({ ...req.body, number: String(req.body.number || '').trim().toUpperCase() }); res.status(201).json(serializeVehicle(vehicle)); }
  catch (error) { next(error); }
});
app.patch('/api/vehicles/:id', async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found.' });
    const fields = ['name', 'model', 'type', 'year', 'ownerName', 'registrationDate', 'fitnessValid', 'taxValid', 'insurance', 'pucc', 'oil', 'grease', 'permit', 'nationalPermit', 'capacity', 'odometer', 'location'];
    for (const field of fields) vehicle[field] = String(req.body[field] || '').trim();
    if (!vehicle.model || !vehicle.type) return res.status(400).json({ message: 'Make/model and vehicle type are required.' });
    await vehicle.save();
    res.json(serializeVehicle(vehicle));
  } catch (error) { next(error); }
});
app.delete('/api/vehicles/:id', async (req, res, next) => {
  try {
    const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found.' });
    await Driver.updateMany({ vehicleNumber: vehicle.number }, { $set: { vehicleNumber: '' } });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.post('/api/drivers', async (req, res, next) => {
  try { const driver = await Driver.create({ name: req.body.name, phone: req.body.phone }); res.status(201).json(serializeDriver(driver)); }
  catch (error) { next(error); }
});
app.delete('/api/drivers/:id', async (req, res, next) => {
  try {
    const driver = await Driver.findByIdAndDelete(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Driver not found.' });
    if (driver.vehicleNumber) await Vehicle.updateOne({ number: driver.vehicleNumber }, { $set: { driver: 'Unassigned', phone: '' } });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.patch('/api/drivers/:id/assignment', async (req, res, next) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: 'Driver not found.' });
    const vehicleNumber = String(req.body.vehicleNumber || '').trim().toUpperCase();
    if (vehicleNumber && !await Vehicle.exists({ number: vehicleNumber })) return res.status(404).json({ message: 'Vehicle not found.' });
    await Driver.updateMany({ vehicleNumber, _id: { $ne: driver._id } }, { $set: { vehicleNumber: '' } });
    const previous = driver.vehicleNumber;
    driver.vehicleNumber = vehicleNumber;
    await driver.save();
    if (previous) await Vehicle.updateOne({ number: previous }, { $set: { driver: 'Unassigned', phone: '' } });
    if (vehicleNumber) await Vehicle.updateOne({ number: vehicleNumber }, { $set: { driver: driver.name, phone: driver.phone } });
    res.json(serializeDriver(driver));
  } catch (error) { next(error); }
});
app.post('/api/trips', async (req, res, next) => {
  try {
    const weight = Number(req.body.weight), rate = Number(req.body.rate), advance = Number(req.body.advance || 0);
    const amount = weight * rate;
    if (!normalizeTripDate(req.body.date) || !Number.isFinite(amount) || weight <= 0 || rate < 0 || advance < 0 || advance > amount) return res.status(400).json({ message: 'Check weight, rate, and advance amounts.' });
    const status = req.body.status || 'Scheduled', paidDate = normalizeTripDate(req.body.paidDate);
    if (!['Scheduled', 'In transit', 'Completed', 'Delayed'].includes(status) || (status === 'Completed' && !paidDate)) return res.status(400).json({ message: 'Enter the balance paid date before completing this trip.' });
    const trip = await Trip.create({ ...req.body, date:normalizeTripDate(req.body.date), paidDate:paidDate || '', status, vehicle: String(req.body.vehicle || '').trim().toUpperCase(), weight, rate, amount, advance, balance: amount - advance, expenses: [] });
    res.status(201).json(serializeTrip(trip));
  } catch (error) { next(error); }
});
app.patch('/api/trips/:id', async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ message: 'Trip not found.' });
    if (trip.status === 'Completed') return res.status(409).json({ message: 'Completed trips cannot be edited.' });
    const { date, paidDate: paidDateInput, challan, vehicle, transporter, party, loading, unloading, material, weight, rate, advance, driver, status } = req.body;
    const numericWeight = Number(weight), numericRate = Number(rate), numericAdvance = Number(advance || 0);
    const amount = numericWeight * numericRate;
    if (!normalizeTripDate(date) || !vehicle || !transporter || !party || !loading || !unloading || !material || !Number.isFinite(amount) || numericWeight <= 0 || numericRate < 0 || numericAdvance < 0 || numericAdvance > amount) {
      return res.status(400).json({ message: 'Check the required trip details, weight, rate, and advance.' });
    }
    if (!['Scheduled', 'In transit', 'Completed', 'Delayed'].includes(status)) return res.status(400).json({ message: 'Invalid trip status.' });
    const paidDate = normalizeTripDate(paidDateInput);
    if (status === 'Completed' && !paidDate) return res.status(400).json({ message: 'Enter the balance paid date before completing this trip.' });
    Object.assign(trip, { date:normalizeTripDate(date), challan: challan || '—', vehicle: String(vehicle).trim().toUpperCase(), transporter, party, loading, unloading, material, weight: numericWeight, rate: numericRate, amount, advance: numericAdvance, balance: amount - numericAdvance, driver: driver || '', status });
    if (paidDate) trip.paidDate = paidDate;
    await trip.save();
    res.json(serializeTrip(trip));
  } catch (error) { next(error); }
});
app.patch('/api/trips/:id/status', async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ message: 'Trip not found.' });
    if (!['Scheduled', 'In transit', 'Completed', 'Delayed'].includes(req.body.status)) return res.status(400).json({ message: 'Invalid trip status.' });
    const paidDate = normalizeTripDate(req.body.paidDate);
    if (req.body.status === 'Completed' && !paidDate) return res.status(400).json({ message: 'Enter the balance paid date before completing this trip.' });
    trip.status = req.body.status;
    if (paidDate) trip.paidDate = paidDate;
    await trip.save(); res.json(serializeTrip(trip));
  } catch (error) { next(error); }
});
app.delete('/api/trips/:id', async (req, res, next) => {
  try {
    const trip = await Trip.findByIdAndDelete(req.params.id);
    if (!trip) return res.status(404).json({ message: 'Trip not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
});
app.post('/api/trips/:id/expenses', async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ message: 'Trip not found.' });
    if (trip.status === 'Completed') return res.status(409).json({ message: 'Completed trips cannot receive new expenses.' });
    const amount = Number(req.body.amount), reason = String(req.body.reason || '').trim();
    if (!(amount > 0) || !reason) return res.status(400).json({ message: 'Enter a valid expense amount and reason.' });
    trip.expenses.push({ amount, reason }); await trip.save(); res.status(201).json(serializeTrip(trip));
  } catch (error) { next(error); }
});
app.patch('/api/trips/:id/expenses/:expenseId', async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ message: 'Trip not found.' });
    const expense = trip.expenses.id(req.params.expenseId);
    if (!expense) return res.status(404).json({ message: 'Expense not found.' });
    const amount = Number(req.body.amount), reason = String(req.body.reason || '').trim();
    if (!(amount > 0) || !reason) return res.status(400).json({ message: 'Enter a valid expense amount and reason.' });
    expense.amount = amount; expense.reason = reason; await trip.save(); res.json(serializeTrip(trip));
  } catch (error) { next(error); }
});
app.delete('/api/trips/:id/expenses/:expenseId', async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ message: 'Trip not found.' });
    const expense = trip.expenses.id(req.params.expenseId);
    if (!expense) return res.status(404).json({ message: 'Expense not found.' });
    expense.deleteOne(); await trip.save(); res.status(204).end();
  } catch (error) { next(error); }
});
app.get('/api/reports/:vehicleNumber', async (req, res, next) => {
  try {
    const normalize = value => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    const search = normalize(req.params.vehicleNumber);
    const allTrips = await Trip.find().sort({ date: -1, createdAt: -1 });
    const trips = allTrips.filter(t => normalize(t.vehicle).includes(search));
    const reports = [...new Set(trips.map(t => t.vehicle))].map(number => {
      const rows = trips.filter(t => t.vehicle === number), completed = rows.filter(t => t.status === 'Completed');
      return { vehicle: number, trips: rows.length, completed: completed.length,
        debit: rows.reduce((s, t) => s + t.expenses.reduce((n, e) => n + e.amount, 0), 0),
        credit: completed.reduce((s, t) => s + t.amount, 0) };
    });
    res.json(reports);
  } catch (error) { next(error); }
});
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/')) return next();
    res.sendFile('index.html', { root: clientDistPath }, error => { if (error) next(error); });
  });
}

app.use((error, _req, res, _next) => {
  if (error.code === 11000) return res.status(409).json({ message: 'A record with that value already exists.' });
  if (error.name === 'ValidationError' || error.name === 'CastError') return res.status(400).json({ message: error.message });
  console.error(error);
  if (error.name === 'MongooseServerSelectionError' || /buffering timed out|ECONNREFUSED|ETIMEDOUT/i.test(error.message || '')) return res.status(503).json({ message: 'MongoDB is unreachable. Check that this server IP is allowed in MongoDB Atlas Network Access and that the cluster is running.' });
  res.status(500).json({ message: 'Server error. Please try again.' });
});

export default app;
