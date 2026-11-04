/**
 * @license
 * SPDX-License-Identifier: MIT
 */

export interface SyntheticPaymentFixture {
  id: string;
  title: string;
  format: 'SWIFT_MT' | 'ISO20022_MX';
  messageType: string;
  description: string;
  expectedOutcome: string;
  rawContent: string;
}

export const SYNTHETIC_PAYMENT_FIXTURES: SyntheticPaymentFixture[] = [
  {
    id: 'mt103_sanctioned_beneficiary',
    title: 'MT103: Sanctioned Beneficiary Candidate',
    format: 'SWIFT_MT',
    messageType: 'MT103',
    description: 'Standard customer transfer where the beneficiary customer is Al-Huda International Trading LLC (DEMO SDN).',
    expectedOutcome: 'FUZZY_NAME_CANDIDATE (Al-Huda International Trading LLC) - Requires Human Review',
    rawContent: `{1:F01DEUTDEDDXXX0000000000}{2:I103HUDADEMOXXXXN}{3:{108:DEMO-PAY-001}}{4:
:20:TX-202611-001
:23B:CRED
:32A:261102EUR1250000,00
:50K:/DE12500700100123456789
BAVARIA INDUSTRIAL GEARS GMBH
MAXIMILIANSTRASSE 14
D-80539 MUENCHEN, GERMANY
:52A:DEUTDEDDXXX
:57A:HUDADEMOXXX
:59:/AE390331234567890123456
AL-HUDA INTERNATIONAL TRADING LLC
SHEIKH ZAYED ROAD, TOWER 4
DUBAI, UNITED ARAB EMIRATES
:70:INVOICE 99120 - CRITICAL TURBINE COMPONENTS
:71A:SHA
-}`,
  },
  {
    id: 'mt202_cov_sanctions_evasion',
    title: 'MT202 COV: Evasion Vector (Clean Sequence A, Designated Sequence B)',
    format: 'SWIFT_MT',
    messageType: 'MT202_COV',
    description: 'Cover payment where interbank routing (Sequence A) appears clean, but underlying commercial ordering customer (Sequence B) is Oceanic Aurora Maritime Ltd (IMO 9123456).',
    expectedOutcome: 'EXACT_IDENTIFIER_MATCH (IMO 9123456) in Sequence B - Mandatory Human Only Block',
    rawContent: `{1:F01CHASUS33AXXX0000000000}{2:I202BARCGB22XXXXN}{3:{108:COV-DEMO-991}}{4:
:20:COV-REF-88192
:21:REL-77123
:32A:261102USD4500000,00
:52A:CHASUS33XXX
:57A:SCBLGB2LXXX
:58A:BARCGB22XXX
:50A:/549300DEMOOAURORA00
OCEANIC AURORA MARITIME LTD
IMO 9123456
MAJURO, MARSHALL ISLANDS
:52A:CHASUS33XXX
:57A:SCBLGB2LXXX
:59:/GB29BARC20000098765432
GLOBAL BUNKERING LOGISTICS LTD
LONDON, UNITED KINGDOM
:70:BUNKER FUEL SETTLEMENT FOR MV OCEANIC AURORA
:72:/ACC/COVER PAYMENT
-}`,
  },
  {
    id: 'pacs008_customer_credit_transfer',
    title: 'pacs.008.001.08: High-Risk Correspondent & Sanctioned Executive',
    format: 'ISO20022_MX',
    messageType: 'pacs.008',
    description: 'ISO 20022 Customer Credit Transfer where the Ultimate Debtor is Dmitry Sergeyevich Volkov (Passport RU-DEMO-8829140).',
    expectedOutcome: 'EXACT_IDENTIFIER_MATCH (Passport RU-DEMO-8829140) - Critical Case',
    rawContent: `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>PACS008-DEMO-20261102-01</MsgId>
      <CreDtTm>2026-11-02T09:30:00Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>E2E-VOLKOV-PRECISION-01</EndToEndId>
        <UETR>c1928374-1234-4567-89ab-cdef01234567</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="EUR">890000.00</IntrBkSttlmAmt>
      <IntrBkSttlmDt>2026-11-02</IntrBkSttlmDt>
      <Dbtr>
        <Nm>VOLKOV PRECISION INSTRUMENTS OOO</Nm>
        <PstlAdr>
          <StrtNm>LENINSKY PROSPEKT</StrtNm>
          <BldgNb>45</BldgNb>
          <TwnNm>MOSCOW</TwnNm>
          <Ctry>RU</Ctry>
        </PstlAdr>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <Othr>
            <Id>40702810900000012345</Id>
          </Othr>
        </Id>
      </DbtrAcct>
      <UltmtDbtr>
        <Nm>Dmitry Sergeyevich Volkov</Nm>
        <PrvtId>
          <DtAndPlcOfBirth>
            <PrvtId>
              <Othr>
                <Id>RU-DEMO-8829140</Id>
              </Othr>
            </PrvtId>
          </DtAndPlcOfBirth>
        </PrvtId>
      </UltmtDbtr>
      <DbtrAgt>
        <FinInstnId>
          <BICFI>SABRRUMMXXX</BICFI>
        </FinInstnId>
      </DbtrAgt>
      <CdtrAgt>
        <FinInstnId>
          <BICFI>BNPAFRPPXXX</BICFI>
        </FinInstnId>
      </CdtrAgt>
      <Cdtr>
        <Nm>EUROPEAN MACHINE TOOLS SA</Nm>
        <PstlAdr>
          <StrtNm>RUE DE LA PAIX</StrtNm>
          <BldgNb>12</BldgNb>
          <TwnNm>PARIS</TwnNm>
          <Ctry>FR</Ctry>
        </PstlAdr>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <IBAN>FR7630006000011234567890189</IBAN>
        </Id>
      </CdtrAcct>
      <RmtInf>
        <Ustrd>PAYMENT FOR CNC LATHE PARTS CONTRACT 99124</Ustrd>
      </RmtInf>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`,
  },
  {
    id: 'pacs009_cov_interbank_transfer',
    title: 'pacs.009.001.08 COV: Financial Institution Credit Transfer with Cover',
    format: 'ISO20022_MX',
    messageType: 'pacs.009 COV',
    description: 'FI credit transfer with underlying cover sequence targeting sanctioned entity Al-Furqan Foundation.',
    expectedOutcome: 'FUZZY_NAME_CANDIDATE (Al-Furqan Humanitarian Relief Foundation)',
    rawContent: `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.009.001.08">
  <FICdtTrf>
    <GrpHdr>
      <MsgId>PACS009COV-20261102-09</MsgId>
      <CreDtTm>2026-11-02T09:35:00Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <IntrBkSttlmDt>2026-11-02</IntrBkSttlmDt>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>FI-COV-TX-9901</EndToEndId>
        <UETR>e8839201-9921-4412-a1b2-c3d4e5f60718</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="USD">320000.00</IntrBkSttlmAmt>
      <InstgAgt>
        <FinInstnId><BICFI>MIDLGB22XXX</BICFI></FinInstnId>
      </InstgAgt>
      <InstdAgt>
        <FinInstnId><BICFI>CHASUS33XXX</BICFI></FinInstnId>
      </InstdAgt>
      <UndrlygCstmrCdtTrf>
        <Dbtr>
          <Nm>HORN RELIEF INITIATIVE LTD</Nm>
          <PstlAdr><TwnNm>NAIROBI</TwnNm><Ctry>KE</Ctry></PstlAdr>
        </Dbtr>
        <Cdtr>
          <Nm>Al-Furqan Humanitarian Relief Foundation</Nm>
          <PstlAdr><TwnNm>MOGADISHU</TwnNm><Ctry>SO</Ctry></PstlAdr>
        </Cdtr>
      </UndrlygCstmrCdtTrf>
    </CdtTrfTxInf>
  </FICdtTrf>
</Document>`,
  },
  {
    id: 'pacs004_payment_return',
    title: 'pacs.004.001.09: Payment Return (Original Debtor Rescreening)',
    format: 'ISO20022_MX',
    messageType: 'pacs.004',
    description: 'Payment return containing original credit transfer references and original debtor Al-Huda General Trading.',
    expectedOutcome: 'FUZZY_NAME_CANDIDATE on Original Debtor - High Risk Return',
    rawContent: `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.004.001.09">
  <PmtRtr>
    <GrpHdr>
      <MsgId>PACS004-RETURN-202611-01</MsgId>
      <CreDtTm>2026-11-02T09:40:00Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
    </GrpHdr>
    <TxInf>
      <RtrId>RTR-9901-REV</RtrId>
      <OrgnlEndToEndId>E2E-ORIGINAL-99120</OrgnlEndToEndId>
      <RtrdIntrBkSttlmAmt Ccy="USD">750000.00</RtrdIntrBkSttlmAmt>
      <RtrRsnInf>
        <Rsn><Cd>AC04</Cd></Rsn>
        <AddtlInf>ACCOUNT CLOSED BY BENEFICIARY</AddtlInf>
      </RtrRsnInf>
      <InstgAgt>
        <FinInstnId><BICFI>CITIUS33XXX</BICFI></FinInstnId>
      </InstgAgt>
      <OrgnlTxRef>
        <Dbtr>
          <Nm>Al Huda General Trading</Nm>
          <PstlAdr><TwnNm>DUBAI</TwnNm><Ctry>AE</Ctry></PstlAdr>
        </Dbtr>
        <Cdtr>
          <Nm>PACIFIC SEAFOOD IMPORTS INC</Nm>
          <PstlAdr><TwnNm>SEATTLE</TwnNm><Ctry>US</Ctry></PstlAdr>
        </Cdtr>
      </OrgnlTxRef>
    </TxInf>
  </PmtRtr>
</Document>`,
  },
  {
    id: 'pain001_multi_tx_batch',
    title: 'pain.001.001.09: Corporate Multi-Payment Batch (2 Transactions)',
    format: 'ISO20022_MX',
    messageType: 'pain.001',
    description: 'Corporate payment initiation file with 2 separate payment instructions: 1 Clean and 1 Sanctioned Semiconductor Entity.',
    expectedOutcome: 'Tx 1: NO_MATCH_FOUND; Tx 2: EXACT_IDENTIFIER_MATCH (LEI 549300DEMOBEIJING01)',
    rawContent: `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInit>
    <GrpHdr>
      <MsgId>PAIN001-BATCH-202611-01</MsgId>
      <CreDtTm>2026-11-02T09:45:00Z</CreDtTm>
      <NbOfTxs>2</NbOfTxs>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>PMT-INF-001</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <ReqdExctnDt><Dt>2026-11-03</Dt></ReqdExctnDt>
      <Dbtr>
        <Nm>GLOBAL TECH VENTURES LTD</Nm>
        <PstlAdr><TwnNm>LONDON</TwnNm><Ctry>GB</Ctry></PstlAdr>
      </Dbtr>
      <DbtrAcct><Id><IBAN>GB33BARC20000012345678</IBAN></Id></DbtrAcct>
      <CdtTrfTxInf>
        <PmtId><EndToEndId>BATCH-TX-001-CLEAN</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">45000.00</InstdAmt></Amt>
        <Cdtr>
          <Nm>ROTTERDAM LOGISTICS BV</Nm>
          <PstlAdr><TwnNm>ROTTERDAM</TwnNm><Ctry>NL</Ctry></PstlAdr>
        </Cdtr>
        <CdtrAcct><Id><IBAN>NL91ABNA0417164300</IBAN></Id></CdtrAcct>
      </CdtTrfTxInf>
      <CdtTrfTxInf>
        <PmtId><EndToEndId>BATCH-TX-002-SANCTIONED</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="USD">2100000.00</InstdAmt></Amt>
        <Cdtr>
          <Nm>Beijing Horizon Microelectronics Co Ltd</Nm>
          <PstlAdr><TwnNm>BEIJING</TwnNm><Ctry>CN</Ctry></PstlAdr>
          <FinInstnId><LEI>549300DEMOBEIJING01</LEI></FinInstnId>
        </Cdtr>
        <CdtrAcct><Id><Othr><Id>CN120993001928374</Id></Othr></Id></CdtrAcct>
      </CdtTrfTxInf>
    </PmtInf>
  </CstmrCdtTrfInit>
</Document>`,
  },
  {
    id: 'mt103_missing_travel_rule',
    title: 'MT103: Severe Travel Rule Missing Data (No Debtor Address or ID)',
    format: 'SWIFT_MT',
    messageType: 'MT103',
    description: 'Payment message where ordering customer has only a name with no address or national ID, violating FATF Recommendation 16 cross-border standards.',
    expectedOutcome: 'CRITICAL_MISSING Data Violation - Blocked for Enrichment',
    rawContent: `{1:F01HSBCHKHHAXXX0000000000}{2:I103SCBLSGSGXXXXN}{4:
:20:TR-MISSING-0991
:23B:CRED
:32A:261102USD150000,00
:50K:UNKNOWN TRADING CO
:59:/SG123456789012
PACIFIC RIM SUPPLIERS PTE LTD
SINGAPORE
:70:PAYMENT FOR GENERAL MERCHANDISE
:71A:SHA
-}`,
  },
  {
    id: 'mt103_clean_payment',
    title: 'MT103: No-Match Synthetic Payment Demo (All Watchlists Fresh)',
    format: 'SWIFT_MT',
    messageType: 'MT103',
    description: 'Fully enriched customer transfer with complete addresses, valid IBANs, and no matching sanctions candidates.',
    expectedOutcome: 'NO_MATCH_FOUND (All Watchlists Fresh) - Deterministically Clearable',
    rawContent: `{1:F01BNPAFRPPXXX0000000000}{2:I103DEUTDEDDXXXXN}{4:
:20:CLEAN-PAY-88219
:23B:CRED
:32A:261102EUR24500,00
:50K:/FR7630006000019988776655443
LUMEN LIGHTING DESIGN SAS
45 BOULEVARD HAUSSMANN
F-75009 PARIS, FRANCE
:52A:BNPAFRPPXXX
:57A:DEUTDEDDXXX
:59:/DE89370400440532013000
BERLIN ARCHITECTURAL FIXTURES GMBH
FRIEDRICHSTRASSE 100
D-10117 BERLIN, GERMANY
:70:INVOICE INV-2026-441 - LED INSTALLATION
:71A:OUR
-}`,
  },
];

// Multi-Module Evaluation Sample Data
export const MULTI_MODULE_FIXTURES = {
  TRADE_AND_CARGO: {
    invoice: {
      invoiceNumber: 'INV-2026-T789',
      date: '2026-11-02',
      sellerName: 'Nordic Marine Precision AS',
      sellerCountry: 'NO',
      buyerName: 'Al-Huda International Trading LLC',
      buyerCountry: 'AE',
      totalAmount: 1850000.0,
      currency: 'USD',
      portOfLoading: 'Oslo Commercial Harbour',
      portOfDischarge: 'Jebel Ali Port, Dubai',
      lineItems: [
        {
          description: 'Industrial pump bearings & seals',
          hsCode: '8413.91',
          quantity: 200,
          unitPrice: 3250.0,
          amount: 650000.0,
        },
        {
          description: 'High-speed centrifuge extraction rotor components',
          hsCode: '8401.20', // Dual-Use Nuclear
          quantity: 12,
          unitPrice: 100000.0,
          amount: 1200000.0,
        },
      ],
    },
    billOfLading: {
      blNumber: 'MAEU987654321',
      blType: 'OCEAN_BILL_OF_LADING' as const,
      carrierName: 'Maersk Line A/S',
      shipperName: 'Nordic Marine Precision AS',
      consigneeName: 'Al-Huda International Trading LLC',
      notifyPartyName: 'Apex Gulf Freight Forwarding',
      portOfLoading: 'Oslo Commercial Harbour',
      portOfDischarge: 'Bandar Abbas Port', // Discrepancy! Invoice says Jebel Ali
      vesselName: 'M/V NORDIC VOYAGER',
      grossWeightKg: 14200,
      cargoDescription: 'Industrial marine parts and centrifuge rotor assembly',
    },
    packingList: {
      packingListNumber: 'PKL-98765',
      totalGrossWeightKg: 16800, // Discrepancy! > 18% difference from B/L
      totalNetWeightKg: 13900,
      packageCount: 24,
    },
    paymentInstruction: {
      paymentRef: 'PAY-T789-001',
      amount: 1850000.0,
      currency: 'USD',
      remitterName: 'Al-Huda International Trading LLC',
      beneficiaryName: 'Nordic Marine Precision AS',
    },
  },

  MARITIME: {
    vessel: {
      imoNumber: '9256858', // Valid checksum: 9*7 + 2*6 + 5*5 + 6*4 + 8*3 + 5*2 = 63+12+25+24+24+10 = 158 -> 8
      mmsi: '214589000',
      vesselName: 'OCEAN PERFUME',
      flagState: 'Panama (PA)',
      callSign: 'HP9182',
      vesselType: 'CRUDE_OIL_TANKER' as const,
      grossTonnage: 84500,
      buildYear: 2004,
    },
    ownershipHierarchy: [
      {
        role: 'REGISTERED_OWNER' as const,
        name: 'Oceanic Aurora Maritime Ltd',
        country: 'Marshall Islands (MH)',
      },
      {
        role: 'COMMERCIAL_MANAGER' as const,
        name: 'Sovcomflot PJSC',
        country: 'Russia (RU)',
      },
      {
        role: 'ISM_MANAGER' as const,
        name: 'Apex Marine Technical Services',
        country: 'Cyprus (CY)',
      },
    ],
    portsCalled: [
      {
        portName: 'Bandar Abbas Oil Terminal',
        unLocode: 'IRBND',
        country: 'Iran (IR)',
        arrivalDate: '2026-10-14',
      },
      {
        portName: 'Fujairah Anchorage',
        unLocode: 'AEFJR',
        country: 'UAE (AE)',
        arrivalDate: '2026-10-28',
      },
    ],
    aisSignals: {
      lastSeenTimestamp: '2026-11-01T14:30:00Z',
      hoursSinceLastBroadcast: 36, // AIS dark activity!
      stsTransferDetected: true,
      knownStsZone: 'Strait of Hormuz Offshore STS Lightering Zone',
      flagChangesLast12Months: 3, // Flag-hopping!
    },
  },

  AIR_CARGO: {
    awbNumber: '176-49281702', // Emirates 176, serial 4928170, check digit = 4928170 % 7 = 2 (Valid!)
    flightNumber: 'EK-9921',
    originAirport: 'DXB',
    destinationAirport: 'FRA',
    transitAirports: ['THR'], // Tehran - High risk transit gateway!
    shipper: {
      name: 'Gulf Aerospace Dynamics LLC',
      address: 'Airport Free Zone, Dubai',
      country: 'AE',
    },
    consignee: {
      name: 'Bavaria Industrial Gears GmbH',
      address: 'Maximilianstrasse 14, Munich',
      country: 'DE',
    },
    notifyParty: {
      name: 'Al-Huda International Trading LLC',
      address: 'Sheikh Zayed Road, Dubai',
      country: 'AE',
    },
    carrierAgent: {
      name: 'Dnata Cargo Logistics',
      address: 'Cargo Village, DXB',
      country: 'AE',
    },
    cargo: {
      description: 'Aircraft avionics radar transceiver modules with titanium alloy housings',
      grossWeightKg: 480,
      piecesCount: 4,
      declaredHsCode: '8542.31', // Microprocessors & electronic assemblies
      isHazardous: false,
    },
  },

  INSURANCE: {
    policyNumber: 'POL-MAR-2026-8819',
    lineOfBusiness: 'MARINE_HULL_AND_CARGO' as const,
    sumInsured: 45000000.0,
    currency: 'USD',
    screeningStage: 'PRE_BIND_UNDERWRITING' as const,
    policyParties: [
      {
        role: 'PRIMARY_INSURED' as const,
        name: 'Vostok Caspian Energy Holding AG',
        entityType: 'ORGANIZATION' as const,
        country: 'CH',
      },
      {
        role: 'PRIMARY_BENEFICIARY' as const,
        name: 'Al-Huda International Trading LLC',
        entityType: 'ORGANIZATION' as const,
        country: 'AE',
      },
    ],
    corporateEntityUbo: {
      entityName: 'Vostok Caspian Energy Holding AG',
      beneficialOwners: [
        {
          name: 'Dmitry Sergeyevich Volkov', // Sanctioned individual on DEMO_OFAC_SDN
          ownershipPercentage: 35.0,
          country: 'RU',
        },
        {
          name: 'Al-Huda International Trading LLC', // Sanctioned entity on DEMO_OFAC_SDN
          ownershipPercentage: 25.0,
          country: 'AE',
        },
        {
          name: 'Geneva Independent Trustees SA',
          ownershipPercentage: 40.0,
          country: 'CH',
        },
      ],
    },
  },

  CRYPTO: {
    asset: 'ETH' as const,
    amount: 145000.0, // High-value transfer ($145,000 USD equivalent)
    sourceAddress: '0xd90e2f925da726b50c4ed8d0fb909a43a04d3efe', // Tornado.Cash Router
    sourceNetwork: 'ETHEREUM' as const,
    destinationAddress: '0x71C83D482bB6A562283995f7DbD35c391B33B106',
    destinationNetwork: 'ETHEREUM' as const,
    travelRuleData: {
      originatorVaspName: 'Unknown Unhosted Mixer',
      originatorVaspLei: undefined,
      beneficiaryVaspName: 'Apex Digital Custody LLC',
      beneficiaryVaspLei: '549300APEXCUSTODY99',
      originator: {
        isLegalPerson: false,
        fullName: 'Anonymous Depositor (Private Key Pool)',
        country: 'UNKNOWN',
      },
      beneficiary: {
        isLegalPerson: true,
        fullName: 'Global Digital Yield Fund SP',
        nationalIdentifierOrLei: '549300YIELDFUND00',
        country: 'KY',
      },
    },
  },

  HEALTHCARE: {
    claimId: 'CLM-MED-2026-44102',
    serviceDate: '2026-10-24',
    billedAmount: 48500.0,
    practitioner: {
      name: 'Dr. Gregory Vance MD',
      npi: '1982736450', // Matches OIG-LEIE Excluded Providers!
      deaNumber: 'BV1234563', // Valid DEA checksum: (1+3+5) + 2*(2+4+6) = 9 + 24 = 33 -> 3
      specialty: 'Interventional Pain Management',
      stateLicense: 'NY-MED-84920',
    },
    supplier: {
      companyName: 'Pharmacia Biotech Solutions LLC',
      taxId: 'US-DEMO-9918234',
      fdaRegistrationNumber: 'FDA-REG-300918',
      country: 'US',
    },
  },

  SECURITIES: {
    // FIX 4.2 New Order Single with Russian Sovereign Debt ISIN XS0805570354 (Sectoral Sanctions)
    rawFixMessage: '8=FIX.4.2|9=135|35=D|49=APEX_BROKER|56=XOFF|11=ORD-2026-0091|55=XS0805570354|48=XS0805570354|22=4|54=1|38=5000000|44=98.50|40=2|59=0|1=CLIENT_ACC_8829|10=224',
    parties: [
      {
        role: 'EXECUTING_BROKER' as const,
        name: 'Apex Capital Prime Brokerage Ltd',
        idValue: 'APEX_BROKER',
      },
      {
        role: 'CLIENT_ACCOUNT' as const,
        name: 'Al-Huda International Trading LLC',
        idValue: 'CLIENT_ACC_8829',
      },
    ],
  },
};
