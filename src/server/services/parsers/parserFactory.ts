/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import {
  CanonicalPaymentTransaction,
  MessageFamily,
  PaymentMessageType,
  SUPPORTED_ISO20022_MX_TYPES,
  SUPPORTED_SWIFT_MT_TYPES,
} from '../../../shared/types.ts';
import {
  detectIso20022MessageType,
  parseIso20022PaymentMessage,
} from './iso20022Parser.ts';
import {
  parseSwiftPaymentMessage,
} from './swiftMtParser.ts';

export interface MessageHeaderDescriptor {
  family: MessageFamily;
  detectedType: PaymentMessageType;
  headerFormat: 'SWIFT_FIN_BLOCKS' | 'SWIFT_TAG_BLOCK' | 'ISO20022_BAH_ENVELOPE' | 'ISO20022_XML_DOCUMENT';
  senderBic?: string;
  receiverBic?: string;
  schemaNamespace?: string;
  serviceVariant?: string;
}

export interface UnifiedParseDispatchResult {
  header: MessageHeaderDescriptor;
  totalTransactions: number;
  transactions: CanonicalPaymentTransaction[];
}

/**
 * Unified Parser Factory capable of dynamically inspecting header structures
 * and dispatching any SWIFT MT (FIN Categories 1-9: MT101..MT999) or ISO 20022 MX
 * (pacs, pain, camt, head, acmt, admi, auth, colr, fxtr, reda, remt, secl, seev,
 * semt, sese, setr, trea, tsin, tsmt, tsrv, caaa, etc.) message.
 */
export class UnifiedParserFactory {
  /**
   * Inspects the raw message header structure to classify family, message type, and envelope metadata.
   */
  public inspectHeader(rawMessage: string): MessageHeaderDescriptor {
    if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      throw new Error('Empty payment payload provided.');
    }

    const trimmed = rawMessage.trim();

    // 1. Check for ISO 20022 MX XML structure (starts with '<' or contains XML namespace/tags)
    if (trimmed.startsWith('<') || /xmlns(?::[a-zA-Z0-9_-]+)?=['"]urn:iso:std:iso:20022/i.test(trimmed)) {
      const hasBah = /<(?:[a-zA-Z0-9_.-]+:)?AppHdr[\s>]/i.test(trimmed) || /head\.001/i.test(trimmed);
      const nsMatch = trimmed.match(/urn:iso:std:iso:20022:tech:xsd:([a-zA-Z0-9._-]+)/i);
      const detectedType = detectIso20022MessageType(trimmed);

      return {
        family: 'ISO20022_MX',
        detectedType,
        headerFormat: hasBah ? 'ISO20022_BAH_ENVELOPE' : 'ISO20022_XML_DOCUMENT',
        schemaNamespace: nsMatch ? `urn:iso:std:iso:20022:tech:xsd:${nsMatch[1]}` : undefined,
      };
    }

    // 2. Check for SWIFT MT FIN block structure ({1:...}{2:...}{3:...}{4:...}) or FIN field tags (:20:, :32A:, etc.)
    const hasFinBlocks = /\{[12345]:[A-Z0-9\s\r\n:{}-]+/i.test(trimmed);
    const hasFinTags = /:[0-9]{2}[A-Z]?:/i.test(trimmed);

    if (hasFinBlocks || hasFinTags) {
      const b1Match = trimmed.match(/\{1:[FAl]\d{2}([A-Z]{4}[A-Z]{2}[A-Z0-9]{2})(?:[A-Z0-9])?([A-Z0-9]{3})?/i);
      const b2Match = trimmed.match(/\{2:[IO](\d{3})([A-Z0-9]*)\}/i);
      const b3VariantMatch = trimmed.match(/\{119:([A-Z0-9]+)\}/i);

      const mtNum = b2Match ? b2Match[1] : trimmed.match(/^\s*MT\s*(\d{3})\b/i)?.[1];
      const serviceVariant = b3VariantMatch ? b3VariantMatch[1].toUpperCase() : undefined;

      let detectedType: PaymentMessageType = 'GENERIC_SWIFT_MT';
      if (mtNum === '202' || mtNum === '205') {
        const isCov =
          serviceVariant === 'COV' ||
          (/:50[A-Z]?:/i.test(trimmed) && (/:59[A-Z]?:/i.test(trimmed) || /:58[A-Z]?:/i.test(trimmed) || /COV/i.test(trimmed)));
        detectedType = (isCov ? `MT${mtNum}_COV` : `MT${mtNum}`) as PaymentMessageType;
      } else if (mtNum === '103') {
        if (serviceVariant === 'STP') detectedType = 'MT103_STP';
        else if (serviceVariant === 'REMIT') detectedType = 'MT103_REMIT';
        else detectedType = 'MT103';
      } else if (mtNum) {
        const suffix = serviceVariant && ['STP', 'COV', 'REMIT'].includes(serviceVariant) ? `_${serviceVariant}` : '';
        detectedType = `MT${mtNum}${suffix}` as PaymentMessageType;
      } else if (/:23B:/i.test(trimmed) || (/:50[A-Z]?:/i.test(trimmed) && /:59[A-Z]?:/i.test(trimmed) && /:32A:/i.test(trimmed))) {
        detectedType = 'MT103';
      }

      return {
        family: 'SWIFT_MT',
        detectedType,
        headerFormat: hasFinBlocks ? 'SWIFT_FIN_BLOCKS' : 'SWIFT_TAG_BLOCK',
        senderBic: b1Match ? `${b1Match[1]}${b1Match[2] || 'XXX'}`.toUpperCase() : undefined,
        serviceVariant,
      };
    }

    throw new Error(
      'Unrecognized message header: payload is neither a valid SWIFT MT (FIN) message nor an ISO 20022 (MX) XML document.'
    );
  }

  /**
   * Dynamically dispatches raw MT or MX messages (single or multi-message batch) based on header structure.
   */
  public dispatch(rawMessage: string, formatHint?: 'SWIFT_MT' | 'ISO20022_MX' | 'AUTO'): UnifiedParseDispatchResult {
    const trimmed = (rawMessage || '').trim();
    if (!trimmed) {
      throw new Error('Empty payment payload provided.');
    }

    if (formatHint === 'ISO20022_MX') {
      const header = this.inspectHeader(trimmed);
      const transactions = parseIso20022PaymentMessage(trimmed);
      return {
        header,
        totalTransactions: transactions.length,
        transactions,
      };
    }

    if (formatHint === 'SWIFT_MT') {
      const header = this.inspectHeader(trimmed);
      const transactions = this.parseSwiftSingleOrBatch(trimmed);
      return {
        header,
        totalTransactions: transactions.length,
        transactions,
      };
    }

    // AUTO header-based detection and routing
    const header = this.inspectHeader(trimmed);
    const transactions =
      header.family === 'ISO20022_MX'
        ? parseIso20022PaymentMessage(trimmed)
        : this.parseSwiftSingleOrBatch(trimmed);

    return {
      header,
      totalTransactions: transactions.length,
      transactions,
    };
  }

  /**
   * Splits multi-message SWIFT FIN batches (delimited by $ or multiple {1:F01 headers) or parses single MT message.
   */
  private parseSwiftSingleOrBatch(trimmed: string): CanonicalPaymentTransaction[] {
    const multiBlockChunks = trimmed
      .split(/(?=\{1:[FAl]\d{2}|\$)/)
      .map((c) => c.replace(/^\$/, '').trim())
      .filter((c) => c.length > 10 && (/\{[124]:/.test(c) || /:[0-9]{2}[A-Z]?:/.test(c)));

    if (multiBlockChunks.length > 1) {
      return multiBlockChunks.map((chunk) => parseSwiftPaymentMessage(chunk));
    }

    return [parseSwiftPaymentMessage(trimmed)];
  }

  /**
   * Returns all supported MT and MX message type families registered in the factory.
   */
  public getSupportedMessageCatalog() {
    return {
      swiftMtTypes: SUPPORTED_SWIFT_MT_TYPES,
      iso20022MxTypes: SUPPORTED_ISO20022_MX_TYPES,
      acceptsDynamicMtRange: 'MT100-MT999 (All SWIFT FIN Categories 1-9)',
      acceptsDynamicMxDomains: [
        'pacs', 'pain', 'camt', 'head', 'acmt', 'admi', 'auth',
        'caaa', 'caad', 'caam', 'cafc', 'cafm', 'cafr', 'cain',
        'canm', 'casr', 'catm', 'catp', 'colr', 'deri', 'fxtr',
        'reda', 'remt', 'secl', 'seeu', 'seev', 'semt', 'sese',
        'setr', 'supl', 'trea', 'tsin', 'tsmt', 'tsrv', 'xsys',
      ],
    };
  }
}

export const unifiedParserFactory = new UnifiedParserFactory();

export function parsePaymentMessageViaFactory(
  rawMessage: string,
  formatHint?: 'SWIFT_MT' | 'ISO20022_MX' | 'AUTO'
): CanonicalPaymentTransaction[] {
  return unifiedParserFactory.dispatch(rawMessage, formatHint).transactions;
}

