import type { Locale } from './i18n/config';
import type messages from './messages/es.json';

// Typed next-intl: translation keys are checked against the Spanish (source) catalog.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
