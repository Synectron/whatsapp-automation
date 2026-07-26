/**
 * Phone-number normalisation for individual (non-group) recipients.
 *
 * WhatsApp addresses individuals as `<countrycode><number>@c.us` with no plus
 * sign, spaces or punctuation. People type numbers every other way, so parse
 * generously and validate strictly.
 */
import { config } from '../config';

export interface ParsedNumber {
  /** Digits only, including country code — e.g. `919876543210`. */
  digits: string;
  /** WhatsApp chat id — e.g. `919876543210@c.us`. */
  chatId: string;
  /** Display form — e.g. `+91 9876543210`. */
  display: string;
}

export class PhoneNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneNumberError';
  }
}

/** ITU-T E.164 allows at most 15 digits; 7 is a realistic lower bound. */
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

/**
 * Normalises a user-typed number.
 *
 * Accepts `+91 98765 43210`, `0091-9876543210`, `9876543210` and similar. A
 * number without a country code uses `defaultCountryCode` when one is
 * configured, because a bare local number is ambiguous otherwise.
 */
export function parsePhoneNumber(
  input: string,
  defaultCountryCode: string = config.contacts.defaultCountryCode,
): ParsedNumber {
  if (!input || !input.trim()) throw new PhoneNumberError('Phone number is required.');

  const raw = input.trim();

  // Already a chat id? Accept it unchanged — checked before the letters guard,
  // since "@c.us" is itself letters.
  const chatIdMatch = /^(\d{7,15})@c\.us$/.exec(raw);
  if (chatIdMatch) return build(chatIdMatch[1]);

  if (/[a-z]/i.test(raw)) throw new PhoneNumberError('Phone number must not contain letters.');

  const hadPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) throw new PhoneNumberError('Phone number must contain digits.');

  // `00` is the international prefix in much of the world; strip it like a `+`.
  let explicitCountryCode = hadPlus;
  if (!hadPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
    explicitCountryCode = true;
  }

  if (!explicitCountryCode) {
    if (!defaultCountryCode) {
      throw new PhoneNumberError(
        'Include the country code (e.g. +91 9876543210), or set DEFAULT_COUNTRY_CODE.',
      );
    }
    const cc = defaultCountryCode.replace(/\D/g, '');
    // A number already starting with the country code is left alone: prefixing
    // again would produce nonsense like 9191xxxxxxxxxx.
    if (!digits.startsWith(cc)) {
      digits = `${cc}${digits.replace(/^0+/, '')}`;
    }
  }

  if (digits.length < MIN_DIGITS) throw new PhoneNumberError(`Number is too short (${digits.length} digits).`);
  if (digits.length > MAX_DIGITS) throw new PhoneNumberError(`Number is too long (${digits.length} digits).`);

  return build(digits);
}

function build(digits: string): ParsedNumber {
  return {
    digits,
    chatId: `${digits}@c.us`,
    display: `+${digits}`,
  };
}

/** Non-throwing variant for validation in forms. */
export function tryParsePhoneNumber(input: string, defaultCountryCode?: string): ParsedNumber | null {
  try {
    return parsePhoneNumber(input, defaultCountryCode);
  } catch {
    return null;
  }
}

/** True for a WhatsApp individual chat id. */
export const isIndividualChatId = (id: string): boolean => /^\d+@c\.us$/.test(id);

/** True for a WhatsApp group chat id. */
export const isGroupChatId = (id: string): boolean => id.endsWith('@g.us');
