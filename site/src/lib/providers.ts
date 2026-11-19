import fallback from '../data/providers';
export const getProviders = (locals: App.Locals) => locals.catalog?.providers ?? fallback;
