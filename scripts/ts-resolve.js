// Lets Node run the console's own modules from scripts/: they import each other without the .ts extension, as Vite
// allows. Loaded with `node --import ./scripts/ts-resolve.js`.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.') || /\.[cm]?[jt]s$/.test(specifier)) throw err;
      return next(`${specifier}.ts`, context);
    }
  },
});
