/**
 * Shared HR / careers mailbox lists that a user can add to their own private contacts in one click
 * (Outreach → Import contacts). They are generic mailboxes from lists shared on social media, not named
 * recruiters, so every row is imported as unverified. Nothing is ever emailed automatically.
 */
import { parseContactsCsv, type ContactDraft } from "./contacts";

export interface StarterList {
  id: string;
  name: string;
  /** Shown next to the import button */
  note: string;
  contacts: ContactDraft[];
}

const list = (id: string, name: string, note: string, csv: string): StarterList => ({
  id, name, note,
  contacts: parseContactsCsv(`Company,Email,Country,Source,Notes\n${csv.trim()}`).contacts,
});

const LEGACY_NOTE = "From an old widely shared list. The address may no longer exist: check the company's careers page before sending.";

export const STARTER_LISTS: StarterList[] = [
  list("india-startups", "India product & AI companies (19)",
    "Careers mailboxes at Indian product, fintech and AI companies. Some are general contact addresses, not HR.", `
Juspay,careers@juspay.in,India,India product HR list,
Razorpay,jobs@razorpay.com,India,India product HR list,
Mudrex,help@mudrex.com,India,India product HR list,Support mailbox; ask to be routed to hiring
Sarvam AI,careers@sarvam.ai,India,India product HR list,
Wadhwani AI,contact@wadhwaniai.org,India,India product HR list,General contact mailbox
D. E. Shaw India,recruiting.india@deshaw.com,India,India product HR list,
DMSS,hr@dmss.co.in,India,India product HR list,
Aspire Systems,careers@aspiresys.com,India,India product HR list,
Aletheia,careers@aletheia.co.in,India,India product HR list,
ISPG,careers@ispg.in,India,India product HR list,
Kanrad,careers@kanrad.com,India,India product HR list,
UBQ,careers@ubq.in,India,India product HR list,
Pramata,careers@pramata.com,India,India product HR list,
Omnesys,careers@omnesysindia.com,India,India product HR list,
KC Link,hr@kclink.com,India,India product HR list,
Catalyst Web Experts,hr@catalystwebexperts.com,India,India product HR list,
eMind Technologies,hr@emindtechnologies.com,India,India product HR list,
Youngsoft,hr@youngsoft.co.in,India,India product HR list,
Infobase,hr@infobase.co.in,India,India product HR list,
`),
  list("india-it-legacy", "India IT services, off-campus (40, old list)",
    "A list that has circulated for years. Many of these domains have changed or shut down, so expect bounces and verify first.", `
HCLTech,careers@noida.hclt.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Infosys,engserv@inf.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE} Infosys uses infosys.com today.
CG Smith Software,resume@cgs.cgsmith.soft.net,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
APCC,irecruit@apcc.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
TechDrive,sunitha@techdriveintl.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Unique Computing,careers@uniquecomputing.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Accord Soft,asiapacific@accord-soft.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
ZenSoft,hrd.zensoft@pacific.net.sg,Singapore,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Zenith Software,hr@zenithsoft.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Velocient,rsg@in.velocient.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Selectica,hr_bgl@selectica.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Think Inc,jobs@thinkbn.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Mphasis,hr@mphasis.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Digital,di.recruit@digital.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE} Digital Equipment Corp. no longer exists.
Alopa,hrindia@alopa.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Silicon Automation Systems,careers@sasi.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Birlasoft,recruitment@birlasoftware.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
WebXL,jobs@webxl.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Talisma,got2b@talisma.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Aditi,got2b@aditi.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
AmSoft,hrd@amsoftis.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Bangalore Software,jobs@bangaloresoftware.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Arthur Andersen,rescw@arthurandersen.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE} Arthur Andersen closed in 2002.
Raffles Software,careers@raffles.soft.net,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
eCosmos,hr_ecosmos@netkracker.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
SAP,sanjukta.sarkar@sap.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE} A named person's address: they may have moved on.
Pundits,protocol@pundits.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Aztec Software,jobs@aztecsoft.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Infosys Banking Software,banking_hrd@infy.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Infosys IS Software,careers.IS@inf.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
HPS (Perot) Global,opportunities@hpsblr.soft.net,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
CSS,jobs@csshome.net,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
CBSI,recruiting@cbsinc.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
NetGalactic,hr@netgalactic.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Orbit-e,livefree@orbit-e.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Tenet,jobs@tenetindia.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
GMR Infotech,opportunities@gmrinfo.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Intergraph,resume_india@intergraph.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Net-Kraft,be@net-kraft.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
Honeywell,career@hiso.honeywell.com,India,Off-campus IT HR list (legacy),${LEGACY_NOTE}
`),
  list("india-60", "Indian IT, product & manufacturing companies (58)",
    "Generic careers / HR mailboxes from a widely shared list. Big companies rarely read these: apply on their careers site too.", `
TCS,careers@tcs.com,India,India 60 HR list,
Infosys,jobs@infosys.com,India,India 60 HR list,
Wipro,careers@wipro.com,India,India 60 HR list,
HCLTech,careers@hcltech.com,India,India 60 HR list,
LTIMindtree,careers@ltimindtree.com,India,India 60 HR list,
Cognizant,careers@cognizant.com,India,India 60 HR list,
Mphasis,careers@mphasis.com,India,India 60 HR list,
Persistent Systems,careers@persistent.com,India,India 60 HR list,
Hexaware,careers@hexaware.com,India,India 60 HR list,
Birlasoft,careers@birlasoft.com,India,India 60 HR list,
Cyient,careers@cyient.com,India,India 60 HR list,
Sonata Software,careers@sonata-software.com,India,India 60 HR list,
KPIT Technologies,careers@kpit.com,India,India 60 HR list,
Zensar Technologies,careers@zensar.com,India,India 60 HR list,
Coforge,careers@coforge.com,India,India 60 HR list,
Zoho,careers@zohocorp.com,India,India 60 HR list,
Freshworks,careers@freshworks.com,India,India 60 HR list,
BrowserStack,careers@browserstack.com,India,India 60 HR list,
InMobi,careers@inmobi.com,India,India 60 HR list,
Razorpay,careers@razorpay.com,India,India 60 HR list,
PhonePe,careers@phonepe.com,India,India 60 HR list,
Paytm,careers@paytm.com,India,India 60 HR list,
Unacademy,careers@unacademy.com,India,India 60 HR list,
Delhivery,careers@delhivery.com,India,India 60 HR list,
BlackBuck,careers@blackbuck.com,India,India 60 HR list,
Happiest Minds,careers@happiestminds.com,India,India 60 HR list,
Sasken,careers@sasken.com,India,India 60 HR list,
Newgen Software,careers@newgensoft.com,India,India 60 HR list,
eClerx,careers@eclerx.com,India,India 60 HR list,
Nucleus Software,careers@nucleussoftware.com,India,India 60 HR list,
Adobe,careers@adobe.com,India,India 60 HR list,
SAP,careers@sap.com,India,India 60 HR list,
Qualcomm,careers@qualcomm.com,India,India 60 HR list,
IBM India,ibmindia@in.ibm.com,India,India 60 HR list,
NTT DATA,careers@nttdata.com,India,India 60 HR list,
DXC Technology,recruitment@dxc.com,India,India 60 HR list,
L&T Technology Services,careers@ltts.com,India,India 60 HR list,
Maruti Suzuki,careers@maruti.co.in,India,India 60 HR list,
MG Motor India,career@mgmotor.co.in,India,India 60 HR list,
Hyundai Motor India,career@hmie.co.in,India,India 60 HR list,
Blue Star,hr@bluestarindia.com,India,India 60 HR list,
Bharat Forge,hrd@bharatforge.com,India,India 60 HR list,
Sansera Engineering,careers@sansera.in,India,India 60 HR list,
Lakshmi Machine Works,careers@lmw.co.in,India,India 60 HR list,
UCAL,hr@ucal.com,India,India 60 HR list,
Wonder Cement,hr@wondercement.com,India,India 60 HR list,
Olectra Greentech,hr@olectra.com,India,India 60 HR list,
IFB Industries,careers@ifbglobal.com,India,India 60 HR list,
Jindal Aluminium,hr@jindalaluminium.com,India,India 60 HR list,
UFlex,hr@uflexltd.com,India,India 60 HR list,
Vedanta,careers@vedanta.co.in,India,India 60 HR list,
Dabur,careers@dabur.com,India,India 60 HR list,
Unilever,careers@unilever.com,India,India 60 HR list,
Force Motors (MTU),careers@force-mtu.com,India,India 60 HR list,
Impetus,careers@impetus.co.in,India,India 60 HR list,
Nihilent,career@nihilent.com,India,India 60 HR list,
Aptech,corporatetrg@aptech.co.in,India,India 60 HR list,
D. E. Shaw India,recruit-india@deshaw.com,India,India 60 HR list,
`),
];
