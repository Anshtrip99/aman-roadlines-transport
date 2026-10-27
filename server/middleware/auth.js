import jwt from 'jsonwebtoken';
export function requireAuth(req, res, next) {
  const token = req.cookies?.fleet_session;
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.clearCookie('fleet_session', cookieOptions());
    return res.status(401).json({ message: 'Your session expired. Please sign in again.' });
  }
}

export const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 });
