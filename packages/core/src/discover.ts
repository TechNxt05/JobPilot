/**
 * Job discovery from public job-board APIs and public job pages (no logins, no API keys).
 * Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Breezy, Zoho Recruit, Keka Hire, Workday, Oracle Recruiting, Eightfold,
 * Amazon and Google Careers publish open roles as JSON or plain pages; other career sites and job aggregators are
 * read through their sitemap and the JobPosting data on each job page. ATS endpoints follow
 * https://github.com/Mersetti/ats-job-board-apis.
 *
 * Pure parsing is separate from fetching, so it is testable offline.
 */
import { findSkills, isKnownSkill, phraseGrounded, skillCategory } from "./skills";
import { jobKey } from "./sync";

export type AtsId = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "recruitee" | "workday" | "oracle" | "eightfold" | "breezy" | "zoho" | "keka" | "google" | "amazon" | "sitemap";

export const ATS_LABELS: Record<AtsId, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  recruitee: "Recruitee",
  workday: "Workday",
  oracle: "Oracle Recruiting",
  eightfold: "Eightfold",
  breezy: "Breezy",
  zoho: "Zoho Recruit",
  keka: "Keka Hire",
  google: "Google Careers",
  amazon: "Amazon Jobs",
  sitemap: "Careers site",
};

export interface JobSource {
  ats: AtsId;
  /** Board identifier in the ATS (case-sensitive for SmartRecruiters) */
  slug: string;
  /** Display name */
  company: string;
}

export interface DiscoveredJob {
  /** Stable id: ats:slug:jobId */
  id: string;
  ats: AtsId;
  slug: string;
  company: string;
  title: string;
  location: string;
  /** true remote, false on-site/hybrid, null unknown */
  remote: boolean | null;
  department: string;
  url: string;
  applyUrl: string;
  /** ISO date, or null when the ATS doesn't say */
  postedAt: string | null;
  /** Plain-text description ("" when the list endpoint has none) */
  text: string;
  /** Shown instead of the ATS name for jobs read from a company's own careers page */
  sourceLabel?: string;
}

/** Companies verified to have a public board (Nov 2026). Users can add more by pasting a careers URL. */
export const DEFAULT_SOURCES: JobSource[] = [
  // AI labs and AI-first companies
  { ats: "ashby", slug: "openai", company: "OpenAI" },
  { ats: "greenhouse", slug: "anthropic", company: "Anthropic" },
  { ats: "ashby", slug: "sarvam", company: "Sarvam AI" },
  { ats: "ashby", slug: "cohere", company: "Cohere" },
  { ats: "ashby", slug: "perplexity", company: "Perplexity" },
  { ats: "ashby", slug: "elevenlabs", company: "ElevenLabs" },
  { ats: "workable", slug: "huggingface", company: "Hugging Face" },
  { ats: "greenhouse", slug: "databricks", company: "Databricks" },
  // India product companies
  { ats: "greenhouse", slug: "razorpaysoftwareprivatelimited", company: "Razorpay" },
  { ats: "greenhouse", slug: "groww", company: "Groww" },
  { ats: "lever", slug: "meesho", company: "Meesho" },
  { ats: "lever", slug: "cred", company: "CRED" },
  { ats: "lever", slug: "zeta", company: "Zeta" },
  { ats: "lever", slug: "paytm", company: "Paytm" },
  { ats: "greenhouse", slug: "inmobi", company: "InMobi" },
  { ats: "greenhouse", slug: "druva", company: "Druva" },
  { ats: "ashby", slug: "atlan", company: "Atlan" },
  // Global tech with India / remote roles
  { ats: "greenhouse", slug: "mongodb", company: "MongoDB" },
  { ats: "greenhouse", slug: "gitlab", company: "GitLab" },
  { ats: "greenhouse", slug: "rubrik", company: "Rubrik" },
  { ats: "ashby", slug: "supabase", company: "Supabase" },
  { ats: "greenhouse", slug: "stripe", company: "Stripe" },
  { ats: "greenhouse", slug: "coinbase", company: "Coinbase" },
  { ats: "greenhouse", slug: "cloudflare", company: "Cloudflare" },
  { ats: "greenhouse", slug: "figma", company: "Figma" },
  { ats: "ashby", slug: "notion", company: "Notion" },
  { ats: "ashby", slug: "ramp", company: "Ramp" },
  { ats: "ashby", slug: "linear", company: "Linear" },
  { ats: "lever", slug: "palantir", company: "Palantir" },
  { ats: "lever", slug: "spotify", company: "Spotify" },
  { ats: "smartrecruiters", slug: "BoschGroup", company: "Bosch" },
  // Developer tools and AI infrastructure (boards checked Nov 2026; FlexAI, Swimm, Qodo, Daytona, Entire,
  // Mozilla.ai, Lyzr and Emergent use Rippling / Notion / Teamtailor or their own pages, which aren't readable here)
  { ats: "ashby", slug: "langchain", company: "LangChain" },
  { ats: "ashby", slug: "cognition", company: "Cognition" },
  { ats: "ashby", slug: "replit", company: "Replit" },
  { ats: "ashby", slug: "factory", company: "Factory" },
  { ats: "ashby", slug: "fireworks", company: "Fireworks AI" },
  { ats: "greenhouse", slug: "lightningai", company: "Lightning AI" },
  { ats: "ashby", slug: "runpod", company: "Runpod" },
  { ats: "ashby", slug: "fal-ai", company: "fal" },
  { ats: "ashby", slug: "inferact", company: "Inferact" },
  { ats: "ashby", slug: "gimlet", company: "Gimlet Labs" },
  { ats: "ashby", slug: "greptile", company: "Greptile" },
  { ats: "ashby", slug: "coderabbit", company: "CodeRabbit" },
  { ats: "ashby", slug: "macroscope", company: "Macroscope" },
  { ats: "ashby", slug: "blitzy", company: "Blitzy" },
  { ats: "ashby", slug: "code-metal", company: "Code Metal" },
  { ats: "ashby", slug: "furtherai", company: "FurtherAI" },
  { ats: "ashby", slug: "sycamore", company: "Sycamore" },
  { ats: "ashby", slug: "guild", company: "Guild.ai" },
  { ats: "ashby", slug: "snyk", company: "Snyk" },
  { ats: "greenhouse", slug: "patronusaiinc", company: "Patronus AI" },
  { ats: "greenhouse", slug: "stackblitz", company: "bolt.new (StackBlitz)" },
  { ats: "workable", slug: "crewai", company: "CrewAI" },
  // Frontier-lab suppliers (boards checked Nov 2026; Dreamteam has no readable board. Note greenhouse "david" is an
  // unrelated company; David AI is ashby "david-ai")
  { ats: "ashby", slug: "afterquery", company: "AfterQuery" },
  { ats: "lever", slug: "humble-robotics", company: "Humble Robotics" },
  { ats: "ashby", slug: "david-ai", company: "David AI" },
  { ats: "ashby", slug: "mirendil", company: "Mirendil" },
  { ats: "ashby", slug: "noeri", company: "Noeri" },
  { ats: "ashby", slug: "fragmentai", company: "Fragment" },
  { ats: "ashby", slug: "coframe", company: "Coframe" },
  { ats: "greenhouse", slug: "graphonai", company: "Graphon Labs" },
  // Healthcare AI (boards checked Nov 2026; Hippocratic AI hosts its own careers page, which isn't readable here.
  // Note ashby "andromeda" is an unrelated company; Andromeda Surgical is "andromedasurgical")
  { ats: "greenhouse", slug: "coherehealth", company: "Cohere Health" },
  { ats: "ashby", slug: "forus", company: "Forus" },
  { ats: "ashby", slug: "ambiencehealthcare", company: "Ambience Healthcare" },
  { ats: "ashby", slug: "openevidence", company: "OpenEvidence" },
  { ats: "ashby", slug: "chartahealth", company: "Charta Health" },
  { ats: "ashby", slug: "tandem-health", company: "Tandem Health" },
  { ats: "ashby", slug: "archy", company: "Archy" },
  { ats: "greenhouse", slug: "suki", company: "Suki" },
  { ats: "ashby", slug: "commure", company: "Commure" },
  { ats: "ashby", slug: "vitalize", company: "Vitalize" },
  { ats: "ashby", slug: "onoshealth", company: "Onos Health" },
  { ats: "ashby", slug: "andromedasurgical", company: "Andromeda Surgical" },
  { ats: "ashby", slug: "general-medicine", company: "General Medicine" },
  { ats: "ashby", slug: "healthleap", company: "Healthleap" },
  // Remote-first companies (boards checked Nov 2026). Not readable here (Workday, Rippling, own pages or empty boards):
  // Symetra, Cengage, Hims & Hers, Deel, Remote, VAST Data, Sorcero, McGraw Hill, Intrado, Docusign, Workiva,
  // MissionWired, Toggl, Atlassian, Shopify, Arkency, Automattic, MailerLite, Akamai, SafetyWing, BairesDev, Xapo, Deltek.
  // Note greenhouse "vast" is Vast (space) and greenhouse "remote" is General Assembly, not VAST Data / Remote.com.
  { ats: "ashby", slug: "zapier", company: "Zapier" },
  { ats: "ashby", slug: "docker", company: "Docker" },
  { ats: "greenhouse", slug: "upstart", company: "Upstart" },
  { ats: "greenhouse", slug: "usergems", company: "UserGems" },
  { ats: "greenhouse", slug: "abnormalsecurity", company: "Abnormal AI" },
  { ats: "greenhouse", slug: "affirm", company: "Affirm" },
  { ats: "greenhouse", slug: "customerio", company: "Customer.io" },
  { ats: "ashby", slug: "kit", company: "Kit" },
  { ats: "lever", slug: "verygoodsecurity", company: "Very Good Security" },
  { ats: "greenhouse", slug: "grafanalabs", company: "Grafana Labs" },
  { ats: "greenhouse", slug: "upwork", company: "Upwork" },
  { ats: "ashby", slug: "posthog", company: "PostHog" },
  { ats: "ashby", slug: "ashby", company: "Ashby" },
  { ats: "ashby", slug: "gitbook", company: "GitBook" },
  { ats: "ashby", slug: "helpscout", company: "Help Scout" },
  { ats: "ashby", slug: "close", company: "Close" },
  { ats: "greenhouse", slug: "brave", company: "Brave" },
  { ats: "lever", slug: "toptal", company: "Toptal" },
  { ats: "ashby", slug: "1password", company: "1Password" },
  { ats: "greenhouse", slug: "canonical", company: "Canonical" },
  { ats: "greenhouse", slug: "digitalocean98", company: "DigitalOcean" },
  { ats: "greenhouse", slug: "bitwarden", company: "Bitwarden" },
  { ats: "ashby", slug: "appcues", company: "Appcues" },
  { ats: "ashby", slug: "buffer", company: "Buffer" },
  { ats: "ashby", slug: "constructor", company: "Constructor" },
  { ats: "workable", slug: "trailofbits", company: "Trail of Bits" },
  { ats: "workable", slug: "awesomemotive", company: "Awesome Motive" },
  { ats: "ashby", slug: "duck-duck-go", company: "DuckDuckGo" },
  { ats: "ashby", slug: "revenuecat", company: "RevenueCat" },
  { ats: "greenhouse", slug: "cloudbeds", company: "Cloudbeds" },
  { ats: "ashby", slug: "clickhouse", company: "ClickHouse" },
  { ats: "ashby", slug: "circle", company: "Circle (circle.so)" },
  // AI for small businesses (boards checked Nov 2026; Tandem Health and Archy are above). Not readable here:
  // Arbio, Jota.ai, Adfin, Redo, Trengo, Lindy, Sensi.AI, GlossGenius, Newo.ai, Constrafor; Digs has an empty board.
  // Note greenhouse "warp" is Warp the terminal; Warp (payroll) is ashby "warp". Ashby "adaptive" is Adaptive (construction).
  { ats: "ashby", slug: "flai", company: "Flai" },
  { ats: "ashby", slug: "broccoli", company: "Broccoli AI" },
  { ats: "ashby", slug: "bobyard", company: "Bobyard" },
  { ats: "ashby", slug: "netic", company: "Netic" },
  { ats: "ashby", slug: "artisan", company: "Artisan" },
  { ats: "lever", slug: "nitra", company: "Nitra" },
  { ats: "ashby", slug: "owner", company: "Owner" },
  { ats: "ashby", slug: "probook", company: "Probook" },
  { ats: "ashby", slug: "warp", company: "Warp (payroll)" },
  { ats: "ashby", slug: "avoca", company: "Avoca" },
  { ats: "ashby", slug: "ambrook", company: "Ambrook" },
  { ats: "ashby", slug: "assorthealth", company: "Assort Health" },
  { ats: "ashby", slug: "valeriehealth", company: "Valerie Health" },
  { ats: "greenhouse", slug: "fronterahealth", company: "Frontera" },
  { ats: "ashby", slug: "adaptive", company: "Adaptive" },
  { ats: "ashby", slug: "nory", company: "Nory" },
  { ats: "smartrecruiters", slug: "partly", company: "Partly" },
  // Conversational AI (boards checked Nov 2026). Not readable here: Leena AI, Omilia, Wati, ConnexAI, Hyro, Front,
  // Talkdesk, Genesys, Pylon (ashby "pylon" is an unrelated mortgage company).
  { ats: "ashby", slug: "happyrobot.ai", company: "HappyRobot" },
  { ats: "ashby", slug: "sierra", company: "Sierra" },
  { ats: "ashby", slug: "decagon", company: "Decagon" },
  { ats: "ashby", slug: "parloa", company: "Parloa" },
  { ats: "greenhouse", slug: "himarley", company: "Hi Marley" },
  { ats: "ashby", slug: "eliseai", company: "EliseAI" },
  { ats: "lever", slug: "netomi", company: "Netomi" },
  { ats: "greenhouse", slug: "observeai", company: "Observe.AI" },
  { ats: "ashby", slug: "vapi", company: "Vapi" },
  { ats: "greenhouse", slug: "podium81", company: "Podium" },
  { ats: "greenhouse", slug: "symphony", company: "Symphony" },
  { ats: "ashby", slug: "iterable", company: "Iterable" },
  // Indian product companies from an off-campus portal list (Nov 2026). The rest of that list (TCS, Infosys, Wipro,
  // HCLTech, Tech Mahindra, LTIMindtree, Persistent, Mphasis, Coforge, Hexaware, Birlasoft, KPIT, Zensar, LTTS,
  // Tata Elxsi, Zoho, Postman, BrowserStack, Chargebee, Juspay, Delhivery) use Workday, Oracle, SuccessFactors or own pages.
  { ats: "smartrecruiters", slug: "freshworks", company: "Freshworks" },
  // Big employers on their own systems (checked live Nov 2026)
  { ats: "google", slug: "google", company: "Google" },
  { ats: "amazon", slug: "amazon", company: "Amazon" },
  { ats: "eightfold", slug: "apply.careers.microsoft.com/microsoft.com", company: "Microsoft" },
  { ats: "eightfold", slug: "paypal/paypal.com", company: "PayPal" },
  { ats: "oracle", slug: "eeho.fa.us2.oraclecloud.com/CX_45001", company: "Oracle" },
  { ats: "oracle", slug: "fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/CX_1", company: "Hexaware" },
  { ats: "workday", slug: "nvidia.wd5/NVIDIAExternalCareerSite", company: "NVIDIA" },
  { ats: "breezy", slug: "accrete-ai", company: "Accrete AI" },
  { ats: "ashby", slug: "hopper", company: "Hopper" },
  { ats: "ashby", slug: "parspec", company: "Parspec" },
  { ats: "ashby", slug: "handshake", company: "Handshake" },
  // Career sites and fresher-job aggregators read through their sitemaps (job pages with JobPosting data)
  { ats: "sitemap", slug: "www.talentd.in", company: "Talentd" },
  { ats: "sitemap", slug: "interndoor.com", company: "InternDoor" },
  { ats: "sitemap", slug: "search.jobs.barclays", company: "Barclays" },
  { ats: "sitemap", slug: "jobs.citi.com", company: "Citi" },
  { ats: "sitemap", slug: "careers.qualcomm.com", company: "Qualcomm" },
  { ats: "sitemap", slug: "careers.synopsys.com", company: "Synopsys" },
  { ats: "sitemap", slug: "jobs.ericsson.com", company: "Ericsson" },
  // Banks, product and chip companies hiring in India, found with findCompanyBoards (checked live Nov 2026)
  { ats: "oracle", slug: "jpmc.fa.oraclecloud.com/CX_1001", company: "JPMorgan Chase" },
  { ats: "eightfold", slug: "morganstanley/morganstanley.com", company: "Morgan Stanley" },
  { ats: "eightfold", slug: "micron/micron.com", company: "Micron" },
  { ats: "eightfold", slug: "autodesk/autodesk.com", company: "Autodesk" },
  { ats: "sitemap", slug: "careers.mastercard.com", company: "Mastercard" },
  { ats: "sitemap", slug: "careers.cisco.com", company: "Cisco" },
  { ats: "sitemap", slug: "careers.adobe.com", company: "Adobe" },
  { ats: "sitemap", slug: "jobs.intuit.com", company: "Intuit" },
  { ats: "sitemap", slug: "careers.arm.com", company: "Arm" },
  { ats: "sitemap", slug: "careers.philips.com", company: "Philips" },
  { ats: "sitemap", slug: "jobs.paloaltonetworks.com", company: "Palo Alto Networks" },
  { ats: "sitemap", slug: "careers.blackrock.com", company: "BlackRock" },
  { ats: "sitemap", slug: "careers.statestreet.com", company: "State Street" },
  { ats: "sitemap", slug: "careers.tesco.com", company: "Tesco" },
  { ats: "smartrecruiters", slug: "ServiceNow", company: "ServiceNow" },
  { ats: "smartrecruiters", slug: "WesternDigital", company: "Western Digital" },
  { ats: "smartrecruiters", slug: "Swiggy", company: "Swiggy" },
  { ats: "smartrecruiters", slug: "Mindtickle", company: "Mindtickle" },
  { ats: "greenhouse", slug: "sigmoid", company: "Sigmoid" },
  { ats: "greenhouse", slug: "twilio", company: "Twilio" },
  { ats: "greenhouse", slug: "okta", company: "Okta" },
  { ats: "greenhouse", slug: "zscaler", company: "Zscaler" },
  { ats: "greenhouse", slug: "highradius", company: "HighRadius" },
  { ats: "greenhouse", slug: "agoda", company: "Agoda" },
  { ats: "ashby", slug: "snowflake", company: "Snowflake" },
  { ats: "ashby", slug: "tekion", company: "Tekion" },
  // From your lists: AI startups, funded companies and target companies (checked live Nov 2026)
  { ats: "workable", slug: "leena-ai", company: "Leena AI" },
  { ats: "ashby", slug: "lyzr", company: "Lyzr AI" },
  { ats: "ashby", slug: "sensi-ai", company: "Sensi.AI" },
  { ats: "ashby", slug: "openrouter", company: "OpenRouter" },
  { ats: "ashby", slug: "e2b", company: "E2B" },
  { ats: "ashby", slug: "nousresearch", company: "Nous Research" },
  { ats: "ashby", slug: "zyphra", company: "Zyphra" },
  { ats: "ashby", slug: "imprint", company: "Imprint" },
  { ats: "greenhouse", slug: "clara", company: "Clara" },
  { ats: "greenhouse", slug: "pathrobotics", company: "Path Robotics" },
  { ats: "sitemap", slug: "careers.unilever.com", company: "Unilever" },
  // From your Nov 26 lists: London / Cambridge AI startups (checked live; Tessl has no readable board)
  { ats: "ashby", slug: "boltz", company: "Boltz" },
  { ats: "ashby", slug: "solveintelligence", company: "Solve Intelligence" },
  { ats: "ashby", slug: "sequence", company: "Sequence" },
  { ats: "workable", slug: "commonai", company: "CommonAI CIC" },
  { ats: "workable", slug: "qureight", company: "Qureight" },
  { ats: "workable", slug: "tidalsense", company: "TidalSense" },
  { ats: "ashby", slug: "edra", company: "Edra" },
  { ats: "ashby", slug: "encord", company: "Encord" },
  { ats: "ashby", slug: "cosine", company: "Cosine" },
  { ats: "ashby", slug: "cuspai", company: "CuspAI" },
  { ats: "ashby", slug: "mimica", company: "Mimica" },
  { ats: "ashby", slug: "hiverge", company: "Hiverge" },
  { ats: "ashby", slug: "beyondmath", company: "BeyondMath" },
  { ats: "ashby", slug: "claimsorted", company: "ClaimSorted" },
  // Wealth / fintech (Model ML and Farther have no readable board)
  { ats: "ashby", slug: "rogo", company: "Rogo" },
  { ats: "greenhouse", slug: "alpaca", company: "Alpaca" },
  { ats: "ashby", slug: "jump", company: "Jump" },
  { ats: "greenhouse", slug: "humaninterest", company: "Human Interest" },
  { ats: "ashby", slug: "allocate", company: "Allocate" },
  { ats: "ashby", slug: "wealth-com", company: "Wealth.com" },
  { ats: "ashby", slug: "savvy", company: "Savvy Wealth" },
  { ats: "ashby", slug: "feathery", company: "Feathery" },
  { ats: "ashby", slug: "moment", company: "Moment" },
  { ats: "ashby", slug: "titan", company: "Titan" },
  { ats: "ashby", slug: "monarchmoney", company: "Monarch Money" },
  { ats: "lever", slug: "anchorage", company: "Anchorage Digital" },
  { ats: "greenhouse", slug: "gemini", company: "Gemini" },
  { ats: "ashby", slug: "sentilink", company: "SentiLink" },
  { ats: "greenhouse", slug: "databento", company: "Databento" },
  { ats: "lever", slug: "finch", company: "Finch" },
  { ats: "greenhouse", slug: "extend", company: "Extend" },
  // AI agent companies (Redo, Emergent, UnifyApps, Creatio, Automation Anywhere, ThoughtSpot, Genesys, Rox and Mistral
  // are not readable here; smartrecruiters "Gong" and "Workato" are unrelated or test boards)
  { ats: "ashby", slug: "serval", company: "Serval" },
  { ats: "ashby", slug: "wonderful", company: "Wonderful" },
  { ats: "ashby", slug: "harvey", company: "Harvey" },
  { ats: "lever", slug: "field-ai", company: "FieldAI" },
  { ats: "ashby", slug: "shield", company: "Shield AI" },
  { ats: "ashby", slug: "deepgram", company: "Deepgram" },
  { ats: "ashby", slug: "claylabs", company: "Clay" },
  { ats: "ashby", slug: "linqapp", company: "Linq" },
  { ats: "ashby", slug: "mercor", company: "Mercor" },
  { ats: "ashby", slug: "genesis", company: "Genesis AI" },
  // Remote AI / ML roles and remote-first AI companies (Arkestro, RunSybil, Hydra Host, Nightfall and HubSpot have no
  // readable board)
  { ats: "greenhouse", slug: "future", company: "Future" },
  { ats: "greenhouse", slug: "oura", company: "Oura" },
  { ats: "ashby", slug: "trm-labs", company: "TRM Labs" },
  { ats: "greenhouse", slug: "talkspace", company: "Talkspace" },
  { ats: "ashby", slug: "vetcove", company: "Vetcove" },
  { ats: "ashby", slug: "quilter", company: "Quilter" },
  { ats: "ashby", slug: "tensorwave", company: "TensorWave" },
  { ats: "ashby", slug: "roboflow", company: "Roboflow" },
  { ats: "ashby", slug: "pika", company: "Pika" },
  { ats: "ashby", slug: "phantom", company: "Phantom" },
  { ats: "ashby", slug: "truemed", company: "Truemed" },
  { ats: "ashby", slug: "horizon3ai", company: "Horizon3.ai" },
  { ats: "ashby", slug: "primeintellect", company: "Prime Intellect" },
  { ats: "ashby", slug: "hightouch", company: "Hightouch" },
  { ats: "greenhouse", slug: "dwelly", company: "Dwelly" },
  { ats: "ashby", slug: "mastra", company: "Mastra" },
  { ats: "recruitee", slug: "tether", company: "Tether" },
  { ats: "ashby", slug: "ruby-labs", company: "Ruby Labs" },
  { ats: "lever", slug: "yuno", company: "Yuno" },
  { ats: "ashby", slug: "finary", company: "Finary" },
  { ats: "ashby", slug: "everai", company: "EverAI" },
  { ats: "greenhouse", slug: "syllo", company: "Syllo" },
  { ats: "greenhouse", slug: "veniceai", company: "Venice.ai" },
  { ats: "ashby", slug: "livekit", company: "LiveKit" },
  { ats: "ashby", slug: "canals", company: "Canals" },
  { ats: "greenhouse", slug: "buzzsolutions", company: "Buzz Solutions" },
  { ats: "greenhouse", slug: "prolific", company: "Prolific" },
  { ats: "ashby", slug: "krea", company: "Krea" },
  { ats: "greenhouse", slug: "snorkelai", company: "Snorkel AI" },
  { ats: "greenhouse", slug: "smarterdx", company: "SmarterDx" },
  { ats: "greenhouse", slug: "zoo", company: "Zoo" },
  { ats: "ashby", slug: "braintrust", company: "Braintrust" },
  // Recently funded (Science, Payhawk, Corma, Humyn Labs, Arva AI and StepSecurity have no readable board)
  { ats: "greenhouse", slug: "isomorphiclabs", company: "Isomorphic Labs" },
  { ats: "greenhouse", slug: "daylightsecurity", company: "Daylight Security" },
  { ats: "ashby", slug: "reflect-orbital", company: "Reflect Orbital" },
  { ats: "ashby", slug: "nebuly", company: "Nebuly" },
  { ats: "greenhouse", slug: "newtonresearch", company: "Newton Research" },
  { ats: "greenhouse", slug: "honehealth", company: "Hone Health" },
  { ats: "ashby", slug: "duet", company: "Duet" },
  { ats: "lever", slug: "promiserobotics", company: "Promise Robotics" },
  { ats: "recruitee", slug: "optics11", company: "Optics11" },
  { ats: "ashby", slug: "zeely", company: "Zeely" },
  // Companies hiring remotely in the US (Rippling and Netflix use their own pages)
  { ats: "ashby", slug: "illumio", company: "Illumio" },
  { ats: "ashby", slug: "vultr", company: "Vultr" },
  { ats: "ashby", slug: "temporal", company: "Temporal" },
  { ats: "greenhouse", slug: "mozilla", company: "Mozilla" },
  { ats: "greenhouse", slug: "apolloio", company: "Apollo.io" },
  { ats: "greenhouse", slug: "mavenclinic", company: "Maven Clinic" },
  { ats: "greenhouse", slug: "garnerhealth", company: "Garner Health" },
  { ats: "greenhouse", slug: "omadahealth", company: "Omada Health" },
  { ats: "greenhouse", slug: "wizinc", company: "Wiz" },
  { ats: "greenhouse", slug: "tanium", company: "Tanium" },
  { ats: "greenhouse", slug: "instacart", company: "Instacart" },
  { ats: "greenhouse", slug: "airbnb", company: "Airbnb" },
  { ats: "lever", slug: "xsolla", company: "Xsolla" },
  { ats: "ashby", slug: "thumbtack", company: "Thumbtack" },
  { ats: "ashby", slug: "skydio", company: "Skydio" },
  { ats: "greenhouse", slug: "purestorage", company: "Pure Storage" },
  { ats: "greenhouse", slug: "armada", company: "Armada" },
  { ats: "ashby", slug: "permitflow", company: "PermitFlow" },
  // AI diagnostics (most of that list use Workday, Rippling or their own pages)
  { ats: "ashby", slug: "overjet", company: "Overjet" },
  { ats: "greenhouse", slug: "freenome", company: "Freenome" },
  { ats: "greenhouse", slug: "prenuvo", company: "Prenuvo" },
  { ats: "lever", slug: "artera", company: "ArteraAI" },
  // From your job links, India hiring (SAP, EY, Apple, Capgemini, Persistent, Infosys, Siemens, CGI, Heizen, foundit
  // and way2fresher pages are not readable here). Visa and Flexera are Workday links you shared; Workday was
  // rate-limiting the check on Nov 26.
  { ats: "smartrecruiters", slug: "ContinentalGroupSectorContiTech", company: "Continental ContiTech" },
  { ats: "workday", slug: "visa.wd5/Visa", company: "Visa" },
  { ats: "workday", slug: "flexerasoftware.wd1/FlexeraSoftware", company: "Flexera" },
  { ats: "breezy", slug: "netrix-global", company: "Netrix Global" },
  { ats: "ashby", slug: "Wisdom-AI", company: "WisdomAI" },
  { ats: "sitemap", slug: "careers.wexinc.com", company: "WEX" },
  { ats: "zoho", slug: "agivant.zohorecruit.in/Careers", company: "Agivant" },
  { ats: "zoho", slug: "evnek.zohorecruit.in/Careers", company: "Evnek" },
  { ats: "zoho", slug: "e6data.zohorecruit.in/Careers", company: "e6data" },
  { ats: "zoho", slug: "algoleap.zohorecruit.com/Careers", company: "Algoleap" },
  { ats: "keka", slug: "anblicks", company: "Anblicks" },
];

// Workday / Oracle / Eightfold slugs have two parts ("nvidia.wd5/NVIDIAExternalCareerSite")
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,99})?$/;

export function isValidSource(s: Partial<JobSource> | null | undefined): s is JobSource {
  return !!s && typeof s.slug === "string" && SLUG.test(s.slug) && typeof s.ats === "string" && s.ats in ATS_LABELS;
}

export function sourceKey(s: Pick<JobSource, "ats" | "slug">): string {
  return `${s.ats}:${s.ats === "smartrecruiters" ? s.slug : s.slug.toLowerCase()}`;
}

const titleCase = (slug: string) => slug.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Recognise a careers / job URL and return its board, e.g.
 * boards.greenhouse.io/acme, job-boards.eu.greenhouse.io/acme/jobs/1, jobs.lever.co/acme, jobs.ashbyhq.com/acme,
 * jobs.smartrecruiters.com/Acme, apply.workable.com/acme, acme.recruitee.com. Also accepts the API URLs.
 */
export function sourceFromUrl(input: string): JobSource | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const make = (ats: AtsId, slug: string | undefined, name?: string): JobSource | null =>
    slug && SLUG.test(slug) ? { ats, slug, company: titleCase(name ?? slug) } : null;

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (host.startsWith("boards-api.")) return make("greenhouse", parts[2]); // /v1/boards/{slug}/jobs
    const forParam = u.searchParams.get("for"); // boards.greenhouse.io/embed/job_board?for=acme
    return make("greenhouse", forParam ?? (parts[0] === "embed" ? undefined : parts[0]));
  }
  if (/(^|\.)lever\.co$/.test(host)) return make("lever", host.startsWith("api.") ? parts[2] : parts[0]);
  if (host === "jobs.ashbyhq.com") return make("ashby", parts[0]);
  if (host === "api.ashbyhq.com") return make("ashby", parts[2]);
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") return make("smartrecruiters", parts[0]);
  if (host === "api.smartrecruiters.com") return make("smartrecruiters", parts[2]);
  if (host === "apply.workable.com") {
    if (parts[0] === "api") return make("workable", parts[4]);
    return parts[0] === "j" ? null : make("workable", parts[0]);
  }
  const rec = host.match(/^([a-z0-9-]+)\.recruitee\.com$/);
  if (rec) return make("recruitee", rec[1]);

  // Workday: nvidia.wd5.myworkdayjobs.com/[en-US/]NVIDIAExternalCareerSite/job/…, or the /wday/cxs/{tenant}/{site} API
  const wd = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const rest = parts[0] === "wday" ? parts.slice(3) : parts;
    const site = /^[a-z]{2}-[A-Z]{2}$/.test(rest[0] ?? "") ? rest[1] : rest[0];
    return site && site !== "job" ? make("workday", `${wd[1]}.${wd[2]}/${site}`, wd[1]) : null;
  }
  // Oracle Recruiting Cloud: {host}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/…
  if (host.endsWith(".oraclecloud.com")) {
    const site = parts[parts.indexOf("sites") + 1] ?? u.searchParams.get("siteNumber");
    return parts.includes("sites") && site ? make("oracle", `${host}/${site}`, host.split(".")[0]) : null;
  }
  // Eightfold: paypal.eightfold.ai/careers… (the company domain is usually {name}.com)
  const ef = host.match(/^([a-z0-9-]+)\.eightfold\.ai$/);
  if (ef && ef[1] !== "app" && ef[1] !== "www") return make("eightfold", `${ef[1]}/${u.searchParams.get("domain") || `${ef[1]}.com`}`, ef[1]);
  // Microsoft runs Eightfold on its own domain
  if (host === "apply.careers.microsoft.com" || host === "jobs.careers.microsoft.com" || host === "careers.microsoft.com") {
    return { ats: "eightfold", slug: "apply.careers.microsoft.com/microsoft.com", company: "Microsoft" };
  }
  if (host === "amazon.jobs") return { ats: "amazon", slug: "amazon", company: "Amazon" };
  const bz = host.match(/^([a-z0-9-]+)\.breezy\.hr$/);
  if (bz) return make("breezy", bz[1]);
  // Zoho Recruit: e6data.zohorecruit.in/jobs/Careers/{id}/… (the portal name is usually "Careers")
  if (/^[a-z0-9-]+\.zohorecruit\.(in|com|eu|com\.au|jp)$/.test(host)) {
    const portal = parts[0] === "jobs" && parts[1] ? parts[1] : "Careers";
    return make("zoho", `${host}/${portal}`, host.split(".")[0]);
  }
  // Keka Hire: anblicks.keka.com/careers/jobdetails/{id}
  const kk = host.match(/^([a-z0-9-]+)\.keka\.com$/);
  if (kk && kk[1] !== "www" && kk[1] !== "app") return make("keka", kk[1]);
  if ((host === "google.com" && u.pathname.startsWith("/about/careers")) || host === "careers.google.com") return { ats: "google", slug: "google", company: "Google" };
  // Job aggregators and career sites read through their sitemap
  const site = SITEMAP_SITES.find((x) => host === x.host.replace(/^www\./, "") || host === x.host);
  if (site) return { ats: "sitemap", slug: site.host, company: site.company };
  return null;
}

/** Sites read through their sitemap + JobPosting pages (no public API). Users can add others from the careers page box. */
export const SITEMAP_SITES: { host: string; company: string }[] = [
  { host: "www.talentd.in", company: "Talentd" },
  { host: "interndoor.com", company: "InternDoor" },
  { host: "search.jobs.barclays", company: "Barclays" },
  { host: "jobs.citi.com", company: "Citi" },
  { host: "careers.qualcomm.com", company: "Qualcomm" },
  { host: "careers.synopsys.com", company: "Synopsys" },
  { host: "jobs.ericsson.com", company: "Ericsson" },
  { host: "jobs.thermofisher.com", company: "Thermo Fisher Scientific" },
  { host: "careers.mastercard.com", company: "Mastercard" },
  { host: "careers.cisco.com", company: "Cisco" },
  { host: "careers.adobe.com", company: "Adobe" },
  { host: "jobs.intuit.com", company: "Intuit" },
  { host: "careers.arm.com", company: "Arm" },
  { host: "careers.philips.com", company: "Philips" },
  { host: "jobs.paloaltonetworks.com", company: "Palo Alto Networks" },
  { host: "careers.blackrock.com", company: "BlackRock" },
  { host: "careers.statestreet.com", company: "State Street" },
  { host: "careers.tesco.com", company: "Tesco" },
  { host: "careers.micron.com", company: "Micron" },
  { host: "careers.unilever.com", company: "Unilever" },
  { host: "careers.wexinc.com", company: "WEX" },
];

/** Public list endpoint for a board. */
export function boardApiUrl(s: JobSource, page = 0): string {
  const slug = encodeURIComponent(s.slug);
  switch (s.ats) {
    case "greenhouse": return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    case "lever": return `https://api.lever.co/v0/postings/${slug}?mode=json`;
    case "ashby": return `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
    case "smartrecruiters": return `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${page * 100}`;
    case "workable": return `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`;
    case "recruitee": return `https://${slug.toLowerCase()}.recruitee.com/api/offers/`;
    case "breezy": return `https://${slug.toLowerCase()}.breezy.hr/json`;
    // Read by their own fetchers (several requests each)
    case "keka": return `https://${slug.toLowerCase()}.keka.com/careers/api/jobs/default/active`;
    // Read by their own fetchers (several requests each, or HTML pages)
    case "workday": case "oracle": case "eightfold": case "zoho": case "google": case "amazon": case "sitemap": return "";
  }
}

/* ------------------------------ HTML → text ------------------------------ */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", bull: "•" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Job-description HTML to readable plain text with line breaks and bullets kept. */
export function htmlToText(html: string): string {
  let s = html;
  // Greenhouse double-encodes: "&lt;div&gt;" → "<div>"
  if (/&lt;\/?[a-z]/i.test(s) && !/<[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(s)
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------ parsing ------------------------------ */

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const iso = (v: unknown): string | null => {
  if (typeof v === "number") return new Date(v).toISOString();
  const str = s(v).trim();
  if (!str) return null;
  const d = new Date(str.replace(/ UTC$/, "Z").replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const REMOTE_WORD = /\bremote\b|work from home|\bwfh\b|anywhere/i;
const remoteFrom = (flag: unknown, ...texts: string[]): boolean | null =>
  flag === true ? true : texts.some((t) => REMOTE_WORD.test(t)) ? true : flag === false ? false : null;

/** Normalise one board's JSON into jobs. Unknown or malformed shapes yield []. */
export function parseBoard(src: JobSource, data: unknown): DiscoveredJob[] {
  const base = { ats: src.ats, slug: src.slug, company: src.company };
  const make = (id: string, j: Omit<DiscoveredJob, "id" | "ats" | "slug" | "company">): DiscoveredJob | null =>
    id && j.title && j.url ? { id: `${src.ats}:${src.slug}:${id}`, ...base, ...j } : null;
  const out: (DiscoveredJob | null)[] = [];

  switch (src.ats) {
    case "greenhouse":
      for (const raw of arr(o(data).jobs)) {
        const j = o(raw);
        const location = s(o(j.location).name);
        out.push(make(s(j.id), {
          title: s(j.title).trim(), location, remote: remoteFrom(null, location),
          department: s(o(arr(j.departments)[0]).name), url: s(j.absolute_url), applyUrl: s(j.absolute_url),
          postedAt: iso(j.first_published) ?? iso(j.updated_at), text: htmlToText(s(j.content)),
        }));
      }
      break;
    case "lever":
      for (const raw of arr(data)) {
        const j = o(raw);
        const c = o(j.categories);
        const location = [s(c.location), ...arr(c.allLocations).map(s)].filter((v, i, a) => v && a.indexOf(v) === i).join(" / ");
        const lists = arr(j.lists).map((l) => `${s(o(l).text)}\n${htmlToText(s(o(l).content))}`).join("\n\n");
        out.push(make(s(j.id), {
          title: s(j.text).trim(), location, remote: j.workplaceType === "remote" ? true : j.workplaceType === "onsite" || j.workplaceType === "hybrid" ? false : remoteFrom(null, location),
          department: s(c.team) || s(c.department), url: s(j.hostedUrl), applyUrl: s(j.applyUrl) || s(j.hostedUrl),
          postedAt: iso(j.createdAt), text: [s(j.descriptionPlain) || htmlToText(s(j.description)), lists, s(j.additionalPlain)].filter(Boolean).join("\n\n").trim(),
        }));
      }
      break;
    case "ashby":
      for (const raw of arr(o(data).jobs)) {
        const j = o(raw);
        if (j.isListed === false) continue;
        const location = [s(j.location), ...arr(j.secondaryLocations).map((l) => s(o(l).location))].filter(Boolean).join(" / ");
        out.push(make(s(j.id), {
          // workplaceType wins: Ashby sets isRemote=true on hybrid roles too
          title: s(j.title).trim(), location,
          remote: j.workplaceType === "Remote" ? true : j.workplaceType === "Hybrid" || j.workplaceType === "OnSite" ? false : remoteFrom(j.isRemote, location),
          department: s(j.team) || s(j.department), url: s(j.jobUrl), applyUrl: s(j.applyUrl) || s(j.jobUrl),
          postedAt: iso(j.publishedAt), text: s(j.descriptionPlain) || htmlToText(s(j.descriptionHtml)),
        }));
      }
      break;
    case "smartrecruiters":
      for (const raw of arr(o(data).content)) {
        const j = o(raw);
        const loc = o(j.location);
        const location = s(loc.fullLocation) || [s(loc.city), s(loc.country).toUpperCase()].filter(Boolean).join(", ");
        const id = s(j.id);
        const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(src.slug)}/${encodeURIComponent(id)}`;
        out.push(make(id, {
          title: s(j.name).trim(), location, remote: remoteFrom(loc.remote, location),
          department: s(o(j.department).label) || s(o(j.function).label), url, applyUrl: url,
          postedAt: iso(j.releasedDate),
          // The list has no description; fetchBoard fills it from the detail endpoint for jobs that pass the filters
          text: "",
        }));
      }
      break;
    case "workable":
      for (const raw of arr(o(data).jobs)) {
        const j = o(raw);
        const location = [s(j.city), s(j.state), s(j.country)].filter(Boolean).join(", ");
        out.push(make(s(j.shortcode), {
          title: s(j.title).trim(), location, remote: remoteFrom(j.telecommuting, location, s(j.title)),
          department: s(j.department), url: s(j.url) || s(j.shortlink), applyUrl: s(j.application_url) || s(j.url),
          postedAt: iso(j.published_on) ?? iso(j.created_at), text: htmlToText(s(j.description)),
        }));
      }
      break;
    case "recruitee":
      for (const raw of arr(o(data).offers)) {
        const j = o(raw);
        const location = s(j.location) || [s(j.city), s(j.country_code)].filter(Boolean).join(", ");
        out.push(make(s(j.id), {
          title: s(j.title).trim(), location, remote: remoteFrom(j.remote, location),
          department: s(j.department), url: s(j.careers_url), applyUrl: s(j.careers_apply_url) || s(j.careers_url),
          postedAt: iso(j.published_at), text: [htmlToText(s(j.description)), htmlToText(s(j.requirements))].filter(Boolean).join("\n\n"),
        }));
      }
      break;
  }
  return out.filter((j): j is DiscoveredJob => !!j);
}

/** Description text from a SmartRecruiters posting detail. */
export function parseSmartRecruitersDetail(data: unknown): string {
  const sections = o(o(o(data).jobAd).sections);
  return ["jobDescription", "qualifications", "additionalInformation"]
    .map((k) => {
      const sec = o(sections[k]);
      const body = htmlToText(s(sec.text));
      return body ? `${s(sec.title)}\n${body}`.trim() : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------ filtering ------------------------------ */

export interface DiscoverFilters {
  /** Any of these must appear in the title (or the description when `searchDescription`). Empty = everything. */
  keywords: string[];
  /** Any of these must appear in the location. Empty = anywhere. */
  locations: string[];
  /** Also keep remote jobs whose location doesn't match */
  includeRemote: boolean;
  /** Hide senior / staff / lead / manager / director roles */
  earlyCareerOnly: boolean;
  /** Only jobs posted in the last N days (jobs without a date are kept). 0 = any time. */
  postedWithinDays: number;
  searchDescription?: boolean;
}

export const DEFAULT_FILTERS: DiscoverFilters = {
  keywords: ["engineer", "developer", "intern", "ai", "ml", "machine learning", "data", "backend", "software"],
  locations: ["india", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi", "gurgaon", "gurugram", "noida", "chennai"],
  includeRemote: true,
  earlyCareerOnly: true,
  postedWithinDays: 60,
};

export const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|lead|leader|head|director|manager|vp|vice president|chief|architect|distinguished|fellow|partner|avp|gm)\b|\b(iii|iv|v)\s*$/i;
export const EARLY_TITLE = /\b(intern(ship)?|new grad|graduate|entry[\s-]level|junior|jr\.?|fresher|trainee|apprentice|associate|early[\s-]career|university|campus|engineer i|sde[\s-]?(i|1)|swe[\s-]?(i|1)|level 1|l1)\b/i;

const TOP_ROLE = /\b(director|vp|vice president|head|chief|principal|manager)\b/i;
/** Senior roles, unless the title is clearly early-career ("Associate Software Engineer", "Lead Generation Intern"). */
export function isSeniorTitle(title: string): boolean {
  return SENIOR_TITLE.test(title) && !(EARLY_TITLE.test(title) && !TOP_ROLE.test(title));
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Word-boundary match so "ai" doesn't hit "maintain" and "ml" doesn't hit "html". */
function containsTerm(haystack: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(t.toLowerCase())}([^a-z0-9]|$)`, "i").test(haystack.toLowerCase());
}

const GLOBAL_REMOTE = /\b(anywhere|global(ly)?|worldwide|world[\s-]?wide|international|apac|asia)\b/i;
/**
 * A remote job is open to you only if it isn't tied to another place: "Remote" or "Remote, Global" pass,
 * "Remote, United States" or "Remote-Friendly | San Francisco" don't (unless that place is in your locations).
 */
export function remoteOpenToAnyone(location: string): boolean {
  if (GLOBAL_REMOTE.test(location)) return true;
  const rest = location
    .replace(/remote[\s-]*(friendly|first|ok)?|work from home|wfh|hybrid|\(travel required\)|distributed|flexible/gi, " ")
    .replace(/[^a-z]+/gi, " ")
    .trim();
  return rest.length === 0;
}

export function matchesFilters(job: DiscoveredJob, f: DiscoverFilters, now = Date.now()): boolean {
  if (f.earlyCareerOnly && isSeniorTitle(job.title)) return false;
  if (f.keywords.length) {
    const hay = f.searchDescription ? `${job.title}\n${job.department}\n${job.text}` : `${job.title} ${job.department}`;
    if (!f.keywords.some((k) => containsTerm(hay, k))) return false;
  }
  if (f.locations.length) {
    const here = f.locations.some((l) => containsTerm(job.location, l));
    if (!here && !(f.includeRemote && job.remote && remoteOpenToAnyone(job.location))) return false;
  }
  if (f.postedWithinDays > 0 && job.postedAt) {
    const age = (now - new Date(job.postedAt).getTime()) / 86_400_000;
    if (age > f.postedWithinDays) return false;
  }
  return true;
}

/** Drop repeats: same URL, or the same company + title + location (multi-board / re-posted roles). */
export function dedupeJobs(jobs: DiscoveredJob[]): DiscoveredJob[] {
  const seen = new Set<string>();
  const out: DiscoveredJob[] = [];
  for (const j of jobs) {
    const keys = [jobKey(j.url), `${j.company}|${j.title}|${j.location}`.toLowerCase().replace(/\s+/g, " ")];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(j);
  }
  return out;
}

/* ------------------------------ fit flags ------------------------------ */

export type FitFlagKind = "eligibility" | "experience" | "work_authorization" | "location" | "seniority" | "student_only" | "field";

/* ------------------------------ is this job in the candidate's field? ------------------------------ */

/** Skills nearly every engineering job lists: alone they don't make a role yours (Python for a CPU-verification job). */
const COMMON_SKILLS = new Set(["git", "linux", "sql", "excel", "jira", "agile", "html", "css", "data structures", "algorithms", "oop",
  "microsoft office", "windows", "communication", "problem solving", "testing", "debugging", "unix", "shell scripting", "bash", "github",
  // Buzzwords half of all postings mention ("leveraging AI"): real AI / ML roles also name their tools (PyTorch, RAG, LLMs)
  "artificial intelligence", "machine learning", "data analysis"]);
const isCommonSkill = (s: string) => skillCategory(s) === "language" || COMMON_SKILLS.has(s.toLowerCase());

/** Titles of software, AI / ML and data roles. */
export const TECH_ROLE = /\b(software|sde|swe|developer|programmer|back[- ]?end|front[- ]?end|full[- ]?stack|web|mobile|android|ios|ai|ml|machine learning|deep learning|gen ?ai|generative|llm|nlp|computer vision|data (scien\w*|engineer\w*|analyst)|analytics engineer|applied scien\w*|research engineer|mlops|devops|platform|cloud|site reliability|sre|python|forward deployed|automation engineer|qa engineer|sdet|api)\b/i;

export interface Relevance {
  relevant: boolean;
  /** The job's specialist skills you have / don't have (languages and everyday tools left out) */
  matched: string[];
  missing: string[];
}

/**
 * Whether a job is in the candidate's field, from the skills it names and its title. A job is relevant when you
 * have at least two of its specialist skills, or it is a software / AI / data role and you have one of them (or two
 * of its skills of any kind, or it names none). Everyday languages and tools never decide it on their own.
 */
export function jobRelevance(job: { title: string; text: string }, jobSkills: string[], candidateText: string): Relevance {
  const all = [...new Set([...jobSkills, ...findSkills(`${job.title}\n${job.text}`).keys()])];
  const candidate = findSkills(candidateText);
  const lower = candidateText.toLowerCase();
  const has = (s: string) => candidate.has(s) || (!isKnownSkill(s) && phraseGrounded(s, lower));
  const core = all.filter((s) => !isCommonSkill(s));
  const matched = core.filter(has);
  const anyMatched = all.filter(has).length;
  const techTitle = TECH_ROLE.test(job.title);
  const relevant = matched.length >= 2 || (techTitle && (matched.length >= 1 || anyMatched >= 2 || all.length === 0));
  return { relevant, matched, missing: core.filter((s) => !has(s)) };
}

export interface FitFlag {
  kind: FitFlagKind;
  /** blocker: you likely can't be considered; caution: worth checking before applying */
  severity: "blocker" | "caution";
  message: string;
}

const WORK_AUTH = /(must be (legally )?authori[sz]ed to work in (the )?(us|u\.s\.|united states|uk|canada|eu|europe|australia)|(no|not able to|unable to|cannot|can't|does not|do not|will not) (provide |offer )?(visa )?sponsor|without (the need for )?(visa )?sponsorship|(us|u\.s\.) citizen(ship)? (is )?required|security clearance|green card)/i;
const STUDENT_ONLY = /(currently enrolled|must be (a )?(current )?(student|enrolled)|pursuing (a|an|your) (bachelor|master|degree)|returning to (school|university)|final[- ]year students? only)/i;

/**
 * Reasons a technically relevant job may still be a poor use of an application, kept separate from the score.
 * `candidate` facts come from the user's profile/resume; unknown facts never produce a flag.
 */
export function fitFlags(
  job: Pick<DiscoveredJob, "title" | "location" | "remote" | "text">,
  ctx: {
    minYearsExperience: number | null;
    candidateMonths: number | null;
    eligibilityNotMet: string[];
    candidateCountry: string;
    /** The candidate has already graduated (graduation year in the past) */
    graduated: boolean | null;
  },
): FitFlag[] {
  const flags: FitFlag[] = [];
  for (const e of ctx.eligibilityNotMet) flags.push({ kind: "eligibility", severity: "blocker", message: e });
  if (ctx.minYearsExperience && ctx.minYearsExperience > 0 && ctx.candidateMonths !== null) {
    const have = ctx.candidateMonths / 12;
    if (have + 0.1 < ctx.minYearsExperience) {
      flags.push({
        kind: "experience",
        severity: ctx.minYearsExperience - have >= 2 ? "blocker" : "caution",
        message: `Asks for ${ctx.minYearsExperience}+ years; your resume shows about ${have.toFixed(1)}`,
      });
    }
  }
  if (isSeniorTitle(job.title)) {
    flags.push({ kind: "seniority", severity: "caution", message: "Senior-level title" });
  }
  const auth = job.text.match(WORK_AUTH);
  if (auth && !/united states|usa|\bus\b|u\.s\./i.test(ctx.candidateCountry)) {
    flags.push({ kind: "work_authorization", severity: "blocker", message: `Work authorization: “${auth[0]}”` });
  }
  if (ctx.graduated === true && STUDENT_ONLY.test(job.text)) {
    flags.push({ kind: "student_only", severity: "blocker", message: "Open to current students only" });
  }
  const country = ctx.candidateCountry.trim().toLowerCase();
  if (country && job.location && !job.remote && !containsTerm(job.location, country) && !(country === "india" && /bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad/i.test(job.location))) {
    flags.push({ kind: "location", severity: "caution", message: `On-site in ${job.location}; check relocation` });
  }
  return flags;
}

/* ------------------------------ fetching ------------------------------ */

export interface FetchBoardOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** SmartRecruiters only: fetch descriptions for jobs passing this test (detail call per job) */
  needsDetail?: (job: DiscoveredJob) => boolean;
  maxDetails?: number;
  /** The user's filters: Workday / Eightfold / Google search by their country, sitemap sites by their keywords */
  filters?: DiscoverFilters;
  /** Sitemap sites: job pages read per scan (default 24) */
  maxPages?: number;
}

async function getJson(url: string, opts: FetchBoardOptions): Promise<unknown> {
  const f = opts.fetchImpl ?? fetch;
  const timer = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timer]) : timer;
  const res = await f(url, { signal, headers: { Accept: "application/json" } });
  if (res.status === 404) throw new Error("Board not found (check the company's slug)");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Every open job on one board. Throws on network errors or an unknown board. */
export async function fetchBoard(src: JobSource, opts: FetchBoardOptions = {}): Promise<DiscoveredJob[]> {
  if (!isValidSource(src)) throw new Error("Invalid board");
  switch (src.ats) {
    case "workday": return fetchWorkday(src, opts);
    case "oracle": return fetchOracle(src, opts);
    case "eightfold": return fetchEightfold(src, opts);
    case "breezy": return fetchBreezy(src, opts);
    case "zoho": return fetchZoho(src, opts);
    case "keka": return parseKekaJobs(src, await getJsonB(boardApiUrl(src), opts));
    case "google": return fetchGoogle(src, opts);
    case "amazon": return fetchAmazon(src, opts);
    case "sitemap": return fetchSitemapSite(src, opts);
  }
  if (src.ats !== "smartrecruiters") return parseBoard(src, await getJson(boardApiUrl(src), opts));

  // SmartRecruiters pages 100 at a time; cap at 3 pages to stay fast
  const jobs: DiscoveredJob[] = [];
  for (let page = 0; page < 3; page++) {
    const data = await getJson(boardApiUrl(src, page), opts);
    const batch = parseBoard(src, data);
    jobs.push(...batch);
    const total = Number(o(data).totalFound) || 0;
    if (batch.length < 100 || jobs.length >= total) break;
  }
  if (opts.needsDetail) {
    const want = jobs.filter(opts.needsDetail).slice(0, opts.maxDetails ?? 20);
    await Promise.all(want.map(async (j) => {
      const id = j.id.split(":").pop()!;
      try {
        const detail = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(src.slug)}/postings/${encodeURIComponent(id)}`, opts);
        j.text = parseSmartRecruitersDetail(detail);
      } catch { /* keep the job without a description */ }
    }));
  }
  return jobs;
}

export interface BoardResult {
  source: JobSource;
  jobs: DiscoveredJob[];
  error: string | null;
}

/** Fetch many boards with limited concurrency; one failing board never fails the rest. */
export async function fetchBoards(sources: JobSource[], opts: FetchBoardOptions & { concurrency?: number } = {}): Promise<BoardResult[]> {
  const results: BoardResult[] = new Array(sources.length);
  // Two queues: sources that need many requests or download megabytes (career-site sitemaps, Lever's full-text
  // boards, Workday / Eightfold / Oracle / Google / Amazon paging) run a few at a time, so they never starve the
  // quick single-request boards running alongside them
  const HEAVY = new Set<AtsId>(["sitemap", "zoho", "lever", "workday", "eightfold", "oracle", "google", "amazon"]);
  const heavy = sources.map((_, i) => i).filter((i) => HEAVY.has(sources[i].ats));
  const light = sources.map((_, i) => i).filter((i) => !HEAVY.has(sources[i].ats));
  const run = async (queue: number[]) => {
    while (queue.length) {
      const i = queue.shift()!;
      try {
        results[i] = { source: sources[i], jobs: await fetchBoard(sources[i], opts), error: null };
      } catch (e) {
        if ((e as Error)?.name === "AbortError" && opts.signal?.aborted) throw e;
        const msg = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" ? "Timed out" : (e as Error).message;
        results[i] = { source: sources[i], jobs: [], error: msg };
      }
    }
  };
  const total = Math.max(1, opts.concurrency ?? 8);
  const heavyWorkers = Math.min(heavy.length, Math.max(1, Math.min(5, Math.floor(total / 3))));
  const lightWorkers = Math.min(light.length, Math.max(1, total - heavyWorkers));
  await Promise.all([
    ...Array.from({ length: heavyWorkers }, () => run(heavy)),
    ...Array.from({ length: lightWorkers }, () => run(light)),
  ]);
  return results;
}

/* ------------------------------ more job systems ------------------------------ */
// Workday, Oracle Recruiting Cloud, Eightfold, Breezy, Google Careers, and any careers site or job aggregator that
// lists its job pages in a sitemap and marks them up as schema.org JobPosting (what Google for Jobs reads).
// Their slugs hold what the API needs:
//   workday   "nvidia.wd5/NVIDIAExternalCareerSite"            ({tenant}.wd{n}/{site})
//   oracle    "fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/CX_1" ({host}/{site number})
//   eightfold "paypal/paypal.com"                              ({subdomain}/{company domain})
//   breezy    "accrete-ai"                                     ({company}.breezy.hr)
//   zoho      "e6data.zohorecruit.in/Careers"                  ({host}/{portal})
//   keka      "anblicks"                                       ({company}.keka.com)
//   google    "google"
//   sitemap   "www.talentd.in"                                 (host)

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

async function request(url: string, opts: FetchBoardOptions, init: RequestInit = {}): Promise<Response> {
  const f = opts.fetchImpl ?? fetch;
  const timer = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timer]) : timer;
  const res = await f(url, { ...init, signal, headers: { ...BROWSER_HEADERS, ...((init.headers as Record<string, string>) ?? {}) } });
  if (res.status === 404) throw new Error("Board not found (check the link)");
  if (res.status === 429) throw new Error("The job site is limiting requests; it will be read again on the next scan");
  if (!res.ok && !(init.redirect === "manual" && res.status >= 300 && res.status < 400)) throw new Error(`HTTP ${res.status}`);
  return res;
}
const getText = async (url: string, opts: FetchBoardOptions) => (await request(url, opts, { headers: { Accept: "text/html,application/xml,text/xml,*/*" } })).text();
const getJsonB = async (url: string, opts: FetchBoardOptions): Promise<unknown> => (await request(url, opts, { headers: { Accept: "application/json" } })).json();
const postJson = async (url: string, body: unknown, opts: FetchBoardOptions): Promise<unknown> =>
  (await request(url, opts, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

/** The country (or first place) in the filters, for systems that search by location: "india" → "India". */
function placeFilter(f?: DiscoverFilters): string {
  const locs = f?.locations ?? [];
  const pick = locs.find((l) => /^(india|united states|usa|united kingdom|uk|canada|germany|singapore|australia|ireland|netherlands)$/i.test(l.trim())) ?? locs[0] ?? "";
  return pick.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Load descriptions for the jobs that pass the filters (one request each, a few at a time). */
async function withDetails(jobs: DiscoveredJob[], opts: FetchBoardOptions, load: (j: DiscoveredJob) => Promise<string>, concurrency = 4): Promise<void> {
  if (!opts.needsDetail) return;
  const want = jobs.filter((j) => !j.text && opts.needsDetail!(j)).slice(0, opts.maxDetails ?? 15);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, want.length) }, async () => {
    while (next < want.length) {
      const j = want[next++];
      try { j.text = await load(j); } catch { /* keep the job without a description */ }
    }
  }));
}

/* ---------- Workday ---------- */

function workdayParts(slug: string) {
  const [hostPart, ...site] = slug.split("/");
  return { host: `${hostPart}.myworkdayjobs.com`, tenant: hostPart.split(".")[0], site: site.join("/") };
}

/** "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" → ISO date. */
export function workdayPostedAt(text: string, now = Date.now()): string | null {
  const t = text.toLowerCase();
  if (/today|just posted/.test(t)) return new Date(now).toISOString();
  if (/yesterday/.test(t)) return new Date(now - 86_400_000).toISOString();
  const m = t.match(/(\d+)\+?\s*days?\s*ago/);
  return m ? new Date(now - Number(m[1]) * 86_400_000).toISOString() : null;
}

export function parseWorkdayJobs(src: JobSource, data: unknown, now = Date.now()): DiscoveredJob[] {
  const { host, site } = workdayParts(src.slug);
  return arr(o(data).jobPostings).flatMap((raw) => {
    const j = o(raw);
    const path = s(j.externalPath);
    const title = s(j.title).trim();
    if (!path || !title) return [];
    const url = `https://${host}/${site}${path}`;
    const location = s(j.locationsText);
    return [{
      id: `workday:${src.slug}:${path.split("_").pop() || path}`, ats: "workday" as const, slug: src.slug, company: src.company,
      title, location, remote: remoteFrom(null, location, s(j.remoteType)), department: "", url, applyUrl: url,
      postedAt: workdayPostedAt(s(j.postedOn), now), text: "",
    }];
  });
}

async function fetchWorkday(src: JobSource, opts: FetchBoardOptions): Promise<DiscoveredJob[]> {
  const { tenant, site, host } = workdayParts(src.slug);
  const api = `https://${host}/wday/cxs/${tenant}/${site}`;
  // Big employers list thousands of roles: search for the country in the filters first (Workday searches locations too)
  let search = placeFilter(opts.filters);
  const jobs: DiscoveredJob[] = [];
  let total = 0;
  for (let page = 0; page < 5; page++) {
    const data = await postJson(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset: page * 20, searchText: search }, opts);
    if (page === 0) total = Number(o(data).total) || 0;
    const batch = parseWorkdayJobs(src, data);
    if (page === 0 && !batch.length && search) { search = ""; page = -1; continue; } // nothing for that place: list everything
    jobs.push(...batch);
    if (batch.length < 20 || jobs.length >= total) break;
  }
  await withDetails(jobs, opts, async (j) => {
    const path = new URL(j.url).pathname.slice(site.length + 1);
    return htmlToText(s(o(o(await getJsonB(`${api}${path}`, opts)).jobPostingInfo).jobDescription));
  }, 2);
  return jobs;
}

/* ---------- Oracle Recruiting Cloud ---------- */

function oracleParts(slug: string) {
  const i = slug.lastIndexOf("/");
  return { host: slug.slice(0, i), site: slug.slice(i + 1) };
}

export function parseOracleJobs(src: JobSource, data: unknown): DiscoveredJob[] {
  const { host, site } = oracleParts(src.slug);
  const item = o(arr(o(data).items)[0]);
  return arr(item.requisitionList).flatMap((raw) => {
    const j = o(raw);
    const id = s(j.Id);
    const title = s(j.Title).trim();
    if (!id || !title) return [];
    const location = [s(j.PrimaryLocation), ...arr(j.secondaryLocations).map((l) => s(o(l).Name))].filter((v, i, a) => v && a.indexOf(v) === i).join(" / ");
    const url = `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${id}`;
    return [{
      id: `oracle:${src.slug}:${id}`, ats: "oracle" as const, slug: src.slug, company: src.company, title, location,
      remote: /remote/i.test(s(j.WorkplaceTypeCode) + s(j.WorkplaceType)) ? true : remoteFrom(null, location),
      department: s(j.Department) || s(j.JobFamily), url, applyUrl: url, postedAt: iso(j.PostedDate),
      text: [s(j.ShortDescriptionStr), s(j.ExternalResponsibilitiesStr), s(j.ExternalQualificationsStr)].map(htmlToText).filter(Boolean).join("\n\n"),
    }];
  });
}

async function fetchOracle(src: JobSource, opts: FetchBoardOptions): Promise<DiscoveredJob[]> {
  const { host, site } = oracleParts(src.slug);
  const api = `https://${host}/hcmRestApi/resources/latest`;
  const jobs: DiscoveredJob[] = [];
  for (let page = 0; page < 2; page++) {
    const data = await getJsonB(`${api}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${encodeURIComponent(site)},limit=100,offset=${page * 100},sortBy=POSTING_DATES_DESC`, opts);
    const batch = parseOracleJobs(src, data);
    jobs.push(...batch);
    if (batch.length < 100 || jobs.length >= (Number(o(arr(o(data).items)[0]).TotalJobsCount) || 0)) break;
  }
  await withDetails(jobs.filter((j) => j.text.length < 200), opts, async (j) => {
    const id = j.id.split(":").pop()!;
    const d = o(arr(o(await getJsonB(`${api}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(id)}%22,siteNumber=${encodeURIComponent(site)}`, opts)).items)[0]);
    return [s(d.ExternalDescriptionStr), s(d.ExternalResponsibilitiesStr), s(d.ExternalQualificationsStr)].map(htmlToText).filter(Boolean).join("\n\n");
  });
  return jobs;
}

/* ---------- Eightfold ---------- */

export function parseEightfoldJobs(src: JobSource, positions: unknown): DiscoveredJob[] {
  const host = eightfoldHost(src.slug);
  return arr(positions).flatMap((raw) => {
    const j = o(raw);
    const id = s(j.id);
    const title = s(j.name).trim();
    if (!id || !title) return [];
    const location = arr(j.locations).map(s).filter(Boolean).join(" / ");
    const url = `https://${host}/careers/job/${id}`;
    const ts = Number(j.postedTs) || Number(j.creationTs) || 0;
    return [{
      id: `eightfold:${src.slug}:${id}`, ats: "eightfold" as const, slug: src.slug, company: src.company, title, location,
      remote: s(j.workLocationOption) === "remote" ? true : s(j.workLocationOption) === "onsite" ? false : remoteFrom(null, location),
      department: s(j.department), url, applyUrl: url, postedAt: ts ? new Date(ts * 1000).toISOString() : null, text: "",
    }];
  });
}

async function fetchEightfold(src: JobSource, opts: FetchBoardOptions): Promise<DiscoveredJob[]> {
  const host = eightfoldHost(src.slug);
  const domain = src.slug.split("/")[1];
  const base = `https://${host}/api/pcsx`;
  const place = placeFilter(opts.filters);
  const jobs: DiscoveredJob[] = [];
  for (let start = 0; start < 100; start += 10) {
    const d = o(o(await getJsonB(`${base}/search?domain=${encodeURIComponent(domain)}&query=&location=${encodeURIComponent(place)}&start=${start}`, opts)).data);
    const batch = parseEightfoldJobs(src, d.positions);
    jobs.push(...batch);
    if (batch.length < 10 || jobs.length >= (Number(d.count) || 0)) break;
  }
  await withDetails(jobs, opts, async (j) =>
    htmlToText(s(o(o(await getJsonB(`${base}/position_details?position_id=${encodeURIComponent(j.id.split(":").pop()!)}&domain=${encodeURIComponent(domain)}&hl=en`, opts)).data).jobDescription)), 2);
  return jobs;
}

/** Eightfold host: "{name}.eightfold.ai", or the company's own domain ("apply.careers.microsoft.com"). */
function eightfoldHost(slug: string): string {
  const first = slug.split("/")[0];
  return first.includes(".") ? first : `${first}.eightfold.ai`;
}

/* ---------- Amazon ---------- */

const COUNTRY_ISO3: Record<string, string> = {
  india: "IND", "united states": "USA", usa: "USA", "united kingdom": "GBR", uk: "GBR", canada: "CAN", germany: "DEU",
  singapore: "SGP", australia: "AUS", ireland: "IRL", netherlands: "NLD",
};

export function parseAmazonJobs(src: JobSource, data: unknown): DiscoveredJob[] {
  return arr(o(data).jobs).flatMap((raw) => {
    const j = o(raw);
    const path = s(j.job_path);
    const title = s(j.title).trim();
    if (!path || !title) return [];
    const url = `https://www.amazon.jobs${path}`;
    const location = s(j.normalized_location) || s(j.location);
    return [{
      id: `amazon:${src.slug}:${s(j.id_icims) || s(j.id)}`, ats: "amazon" as const, slug: src.slug, company: src.company, title, location,
      remote: remoteFrom(null, location), department: s(j.job_category) || s(j.business_category), url, applyUrl: s(j.url_next_step) || url,
      postedAt: iso(j.posted_date),
      text: [s(j.description), s(j.basic_qualifications) && `Basic qualifications\n${s(j.basic_qualifications)}`, s(j.preferred_qualifications) && `Preferred qualifications\n${s(j.preferred_qualifications)}`]
        .filter(Boolean).map(htmlToText).join("\n\n"),
    }];
  });
}

/** amazon.jobs: the newest roles in the filters' country (300 at most), descriptions included. */
async function fetchAmazon(src: JobSource, opts: FetchBoardOptions): Promise<DiscoveredJob[]> {
  const country = COUNTRY_ISO3[placeFilter(opts.filters).toLowerCase()];
  const jobs: DiscoveredJob[] = [];
  for (let page = 0; page < 3; page++) {
    const q = new URLSearchParams({ result_limit: "100", sort: "recent", offset: String(page * 100), base_query: "" });
    if (country) q.append("normalized_country_code[]", country);
    const data = await getJsonB(`https://www.amazon.jobs/en/search.json?${q}`, opts);
    const batch = parseAmazonJobs(src, data);
    jobs.push(...batch);
    if (batch.length < 100) break;
  }
  return jobs;
}

/* ---------- Breezy ---------- */

export function parseBreezyJobs(src: JobSource, data: unknown): DiscoveredJob[] {
  return arr(data).flatMap((raw) => {
    const j = o(raw);
    const id = s(j.id);
    const title = s(j.name).trim();
    const url = s(j.url);
    if (!id || !title || !url) return [];
    const loc = o(j.location);
    const location = s(loc.name) || [s(loc.city), s(o(loc.state).name), s(o(loc.country).name)].filter(Boolean).join(", ");
    return [{
      id: `breezy:${src.slug}:${id}`, ats: "breezy" as const, slug: src.slug, company: s(j.company && o(j.company).name) || src.company, title, location,
      remote: remoteFrom(loc.is_remote, location), department: s(j.department), url, applyUrl: url, postedAt: iso(j.published_date), text: "",
    }];
  });
}

async function fetchBreezy(src: JobSource, opts: FetchBoardOptions): Promise<DiscoveredJob[]> {
  const jobs = parseBreezyJobs(src, await getJsonB(`https://${encodeURIComponent(src.slug.toLowerCase())}.breezy.hr/json`, opts));
  await withDetails(jobs, opts, async (j) => jobsFromJsonLd(await getText(j.url, opts), j.url)[0]?.text ?? "");
  return jobs;
}

/* ---------- Zoho Recruit ---------- */

/** Jobs a Zoho Recruit careers page carries in its hidden `<input id="jobs" value="[…]">` (HTML-escaped JSON). */
export function parseZohoJobs(src: JobSource, html: string): DiscoveredJob[] {
  const tag = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).find((x) => /\sid="jobs"/.test(x));
  const raw = tag?.match(/\svalue="([^"]*)"/)?.[1];
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(decodeEntities(raw)); } catch { return []; }
  const i = src.slug.lastIndexOf("/");
  const host = src.slug.slice(0, i), portal = src.slug.slice(i + 1);
  return arr(data).flatMap((r) => {
    const j = o(r);
    const id = s(j.id);
    const title = (s(j.Posting_Title) || s(j.Job_Opening_Name)).trim();
    if (!id || !title || j.Publish === false) return [];
    const location = [s(j.City), s(j.State), s(j.Country)].filter(Boolean).join(", ");
    const url = `https://${host}/jobs/${portal}/${id}/${title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    return [{
      id: `zoho:${src.slug}:${id}`, ats: "zoho" as const, slug: src.slug, company: src.company, title, location,
      remote: typeof j.Remote_Job === "boolean" ? j.Remote_Job : remoteFrom(null, location), department: s(j.Industry), url, applyUrl: url,
      postedAt: iso(j.Date_Opened), text: htmlToText(s(j.Job_Description)),
    }];
  });
}

async function fetchZoho(src: JobSource, opts: FetchBoardOptions): Promise<DiscoveredJob[]> {
  const i = src.slug.lastIndexOf("/");
  return parseZohoJobs(src, await getText(`https://${src.slug.slice(0, i)}/jobs/${encodeURIComponent(src.slug.slice(i + 1))}`, opts));
}

/* ---------- Keka Hire ---------- */

export function parseKekaJobs(src: JobSource, data: unknown): DiscoveredJob[] {
  const sub = src.slug.toLowerCase();
  return arr(data).flatMap((r) => {
    const j = o(r);
    const id = s(j.id);
    const title = s(j.title).trim();
    if (!id || !title) return [];
    const location = arr(j.jobLocations).map((l) => [s(o(l).city) || s(o(l).name), s(o(l).countryName)].filter(Boolean).join(", ")).filter(Boolean).join(" / ");
    const url = `https://${sub}.keka.com/careers/jobdetails/${id}`;
    return [{
      id: `keka:${sub}:${id}`, ats: "keka" as const, slug: src.slug, company: src.company, title, location,
      remote: remoteFrom(null, location, title), department: s(j.departmentName), url, applyUrl: url,
      postedAt: iso(j.publishedOn), text: htmlToText(s(j.description)),
    }];
  });
}

/* ---------- Google Careers ---------- */

/** Job cards on a Google Careers results page: title (link label), locations and minimum qualifications. */
export function parseGoogleJobs(src: JobSource, html: string): DiscoveredJob[] {
  const out: DiscoveredJob[] = [];
  const seen = new Set<string>();
  const links = [...html.matchAll(/href="jobs\/results\/(\d+)-([a-z0-9-]*)[^"]*"[^>]{0,200}?aria-label="Learn more about ([^"]+)"/g)];
  let prev = 0;
  for (const m of links) {
    const card = html.slice(prev, m.index);
    prev = (m.index ?? 0) + m[0].length;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    // Each location appears twice (card + tooltip), with "; " separators of its own
    const location = [...card.matchAll(/class="r0wTof[^"]*">([^<]+)</g)]
      .map((x) => decodeEntities(x[1]).replace(/^[;\s]+|[;\s]+$/g, "").trim())
      .filter((v, i, a) => v && a.indexOf(v) === i).join("; ");
    const quals = card.match(/Minimum qualifications<\/h4>\s*(<ul>[\s\S]*?<\/ul>)/)?.[1] ?? "";
    const url = `https://www.google.com/about/careers/applications/jobs/results/${id}-${m[2]}`;
    out.push({
      id: `google:google:${id}`, ats: "google", slug: src.slug, company: src.company || "Google", title: decodeEntities(m[3]).trim(), location,
      remote: remoteFrom(null, location), department: "", url, applyUrl: url, postedAt: null,
      text: quals ? `Minimum qualifications\n${htmlToText(quals)}` : "",
    });
  }
  return out;
}

async function fetchGoogle(src: JobSource, opts: FetchBoardOptions): Promise<DiscoveredJob[]> {
  const params = new URLSearchParams();
  const place = placeFilter(opts.filters);
  if (place) params.set("location", place);
  if (opts.filters?.earlyCareerOnly !== false) {
    params.append("target_level", "EARLY");
    params.append("target_level", "INTERN_AND_APPRENTICE");
  }
  const jobs: DiscoveredJob[] = [];
  for (let page = 1; page <= 4; page++) {
    params.set("page", String(page));
    const batch = parseGoogleJobs(src, await getText(`https://www.google.com/about/careers/applications/jobs/results?${params}`, opts));
    const fresh = batch.filter((j) => !jobs.some((x) => x.id === j.id));
    jobs.push(...fresh);
    if (fresh.length < 10) break;
  }
  return jobs;
}

/* ---------- any careers site with a sitemap ---------- */

/** schema.org JobPosting data in a page (Google for Jobs markup) → jobs. */
export function jobsFromJsonLd(html: string, pageUrl: string, source?: Pick<JobSource, "ats" | "slug" | "company">): DiscoveredJob[] {
  let host = "";
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
  const jobs: DiscoveredJob[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const graph = o(data)["@graph"];
    const nodes: unknown[] = Array.isArray(data) ? data : Array.isArray(graph) ? graph : [data];
    for (const n of nodes) {
      const j = o(n);
      const type = j["@type"];
      if (!(type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))) continue;
      const org = o(j.hiringOrganization);
      const places = Array.isArray(j.jobLocation) ? j.jobLocation : [j.jobLocation];
      const location = places
        .map((p) => { const a = o(o(p).address); return [s(a.addressLocality), s(a.addressRegion), s(o(a.addressCountry).name) || s(a.addressCountry)].filter(Boolean).join(", "); })
        .filter((v, i, a) => v && a.indexOf(v) === i).join(" / ");
      const company = s(org.name).trim() || source?.company || host;
      // Aggregators title posts "IBM is Hiring Quality Engineer …": keep the role
      // "IBM is Hiring …", "IBM Bangalore Hiring …", "UST Hiring …": the words before "hiring" (company, maybe city) go
      const raw = decodeEntities(s(j.title)).trim();
      const lead = raw.match(/^(.{0,40}?)\s+(?:is\s+)?hiring\s+(?:for\s+)?(.+)$/i);
      const title = lead && lead[1].toLowerCase().startsWith(company.toLowerCase().split(/\s+/)[0]) ? lead[2].trim() : raw;
      if (!title) continue;
      const url = s(j.url) || pageUrl;
      const id = s(o(j.identifier).value) || s(j.identifier) || url;
      jobs.push({
        id: `${source?.ats ?? "page"}:${source?.slug ?? host}:${id}`,
        ats: source?.ats ?? "greenhouse", // page jobs (no source) are never fetched as a board; sourceLabel is shown
        sourceLabel: source?.company ?? "Careers page",
        slug: source?.slug ?? host,
        company,
        title,
        location,
        remote: s(j.jobLocationType).toUpperCase() === "TELECOMMUTE" ? true : remoteFrom(null, location),
        department: "",
        url,
        applyUrl: url,
        postedAt: iso(j.datePosted),
        text: htmlToText(s(j.description)),
      });
    }
  }
  return jobs;
}

/** A host the server may read: a real domain name, never localhost, an IP address or an internal name. */
function publicHost(h: string): boolean {
  const host = h.toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && !/(^|\.)(localhost|local|internal)$/.test(host);
}

const JOB_SECTION = /\/(jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|opportunit(?:y|ies))\//i;
const LISTING_PAGE = /^(jobs-in-.*|.*-jobs|jobs|careers|search|alerts?|internships?|freshers?|remote|companies|categories)$/i;

/** A job page address (not a category, city or search page): a long title slug or a numeric id under a jobs path. */
export function looksLikeJobUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const segs = u.pathname.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  if (!JOB_SECTION.test(`${u.pathname}/`) || LISTING_PAGE.test(last)) return false;
  return /\d{4,}/.test(u.pathname) || last.split("-").length >= 4;
}

/** The words in a job page address: ".../job/pune/software-engineer/13015/98..." → "pune software engineer". */
const urlWords = (url: string) => {
  try { return decodeURIComponent(new URL(url).pathname).replace(/\d{4,}/g, " ").replace(/[-_/.]+/g, " ").replace(/\s+/g, " ").trim(); } catch { return ""; }
};

/** GET a page of a user-chosen site, following redirects only to other public hosts (never internal addresses). */
async function getPublicText(url: string, opts: FetchBoardOptions): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Not a web address");
    if (!publicHost(u.hostname)) throw new Error("Not a public website");
    const res = await request(current, opts, { redirect: "manual", headers: { Accept: "text/html,application/xml,text/xml,*/*" } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect without an address");
      current = new URL(loc, current).toString();
      continue;
    }
    return res.text();
  }
  throw new Error("Too many redirects");
}

async function sitemapUrls(host: string, opts: FetchBoardOptions): Promise<{ loc: string; mod: string }[]> {
  const base = `https://${host}`;
  let maps: string[] = [];
  try {
    maps = [...(await getPublicText(`${base}/robots.txt`, opts)).matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  } catch { /* no robots.txt */ }
  if (!maps.length) maps = [`${base}/sitemap.xml`];
  // Job sitemaps first; skip tag / skill / category / company maps
  const rank = (u: string) => (/job|career|position|opening/i.test(u) ? 0 : 1) + (/skill|tag|categor|compan|locat|article|news|blog|author|topic/i.test(u) ? 2 : 0);
  maps = maps.filter((m) => { try { return new URL(m).hostname.endsWith(host.replace(/^www\./, "")); } catch { return false; } }).sort((a, b) => rank(a) - rank(b)).slice(0, 2);
  const entries: { loc: string; mod: string }[] = [];
  const read = async (url: string, depth: number) => {
    const xml = await getPublicText(url, opts);
    if (/<sitemapindex/i.test(xml) && depth === 0) {
      const children = [...xml.matchAll(/<loc>\s*([^<\s]+)/g)].map((m) => decodeEntities(m[1])).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
      for (const c of children) await read(c, 1).catch(() => {});
      return;
    }
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = decodeEntities(m[1].match(/<loc>\s*([^<\s]+)/)?.[1] ?? "");
      if (loc) entries.push({ loc, mod: m[1].match(/<lastmod>\s*([^<\s]+)/)?.[1] ?? "" });
      if (entries.length > 30_000) break;
    }
  };
  for (const m of maps) await read(m, 0).catch(() => {});
  return entries;
}

/**
 * Jobs from a careers site or job aggregator that has no public API (Talentd, InternDoor, Radancy career sites like
 * Barclays and Citi): its sitemap lists every job page, and each page carries JobPosting data. Pages whose address
 * matches the keywords are read first, newest first, up to `maxPages`.
 */
async function fetchSitemapSite(src: JobSource, opts: FetchBoardOptions): Promise<DiscoveredJob[]> {
  const host = src.slug.toLowerCase();
  if (!publicHost(host)) throw new Error("Not a public website");
  const bare = host.replace(/^www\./, "");
  const f = opts.filters;
  const candidates = (await sitemapUrls(host, opts))
    .filter((e) => { try { const h = new URL(e.loc).hostname.toLowerCase(); return (h === bare || h.endsWith(`.${bare}`)) && looksLikeJobUrl(e.loc); } catch { return false; } })
    .map((e, i) => ({ ...e, i, words: urlWords(e.loc) }))
    .filter((e) => !f?.keywords.length || f.keywords.some((k) => containsTerm(e.words, k)))
    .filter((e) => !f?.earlyCareerOnly || !isSeniorTitle(e.words));
  if (!candidates.length) return [];
  // Sites that list every job in several languages: keep the English pages ("/cs/job/…" → skip, "/en/…" or none → keep)
  const foreign = (url: string) => { try { return /^\/(?!en(?:[-_][a-z]{2})?\/)[a-z]{2}(?:[-_][a-z]{2})?\//i.test(new URL(url).pathname); } catch { return false; } };
  if (candidates.some((c) => !foreign(c.loc))) candidates.splice(0, candidates.length, ...candidates.filter((c) => !foreign(c.loc)));
  const inPlace = (w: string) => !!f?.locations.some((l) => containsTerm(w, l));
  candidates.sort((a, b) => Number(inPlace(b.words)) - Number(inPlace(a.words)) || b.mod.localeCompare(a.mod) || a.i - b.i);
  const pages = candidates.slice(0, opts.maxPages ?? 24);
  const jobs: DiscoveredJob[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, pages.length) }, async () => {
    while (next < pages.length) {
      const p = pages[next++];
      try {
        const found = jobsFromJsonLd(await getPublicText(p.loc, opts), p.loc, src);
        jobs.push(...found.slice(0, 1).map((j) => ({ ...j, url: p.loc, applyUrl: j.applyUrl === j.url ? p.loc : j.applyUrl, id: `sitemap:${src.slug}:${p.loc}` })));
      } catch { /* skip that page */ }
    }
  }));
  return jobs;
}

