/**
 * Skill taxonomy + matcher.
 *
 * Each skill has a canonical name and aliases. Aliases written in the
 * `cs` list are matched case-sensitively, which keeps common English words
 * ("React to feedback", "Go to market", "excel at") from counting as skills.
 */

export type SkillCategory =
  | "language"
  | "frontend"
  | "backend"
  | "mobile"
  | "data"
  | "ml"
  | "cloud"
  | "devops"
  | "database"
  | "testing"
  | "tools"
  | "concepts"
  | "security"
  | "design"
  | "business"
  | "hardware"
  | "other";

interface SkillDef {
  name: string;
  category: SkillCategory;
  /** case-insensitive aliases (the canonical name is always included) */
  aliases?: string[];
  /** case-sensitive aliases */
  cs?: string[];
  /** if true the canonical name itself is matched case-sensitively */
  csName?: boolean;
}

const SKILLS: SkillDef[] = [
  // Languages
  { name: "Python", category: "language" },
  { name: "Java", category: "language" },
  { name: "JavaScript", category: "language", aliases: ["ECMAScript", "ES6"], cs: ["JS"] },
  { name: "TypeScript", category: "language" },
  { name: "C++", category: "language", aliases: ["CPP", "C/C++"] },
  { name: "C#", category: "language", aliases: ["C Sharp"] },
  { name: "Go", category: "language", aliases: ["Golang"], csName: true },
  { name: "Rust", category: "language", csName: true },
  { name: "Kotlin", category: "language" },
  { name: "Swift", category: "language", csName: true },
  { name: "PHP", category: "language" },
  { name: "Ruby", category: "language" },
  { name: "Scala", category: "language" },
  { name: "Dart", category: "language", csName: true },
  { name: "MATLAB", category: "language" },
  { name: "SQL", category: "database" },
  { name: "Bash", category: "tools", aliases: ["Shell Scripting", "Shell"] },
  { name: "Solidity", category: "language" },
  { name: "Verilog", category: "language", aliases: ["VHDL"] },

  // Frontend
  { name: "HTML", category: "frontend", aliases: ["HTML5"] },
  { name: "CSS", category: "frontend", aliases: ["CSS3"] },
  { name: "React", category: "frontend", aliases: ["React.js", "ReactJS"], csName: true },
  { name: "Next.js", category: "frontend", aliases: ["NextJS"] },
  { name: "Angular", category: "frontend", aliases: ["AngularJS"] },
  { name: "Vue.js", category: "frontend", aliases: ["Vue", "VueJS"] },
  { name: "Svelte", category: "frontend" },
  { name: "Redux", category: "frontend" },
  { name: "Tailwind CSS", category: "frontend", aliases: ["Tailwind", "TailwindCSS"] },
  { name: "Sass", category: "frontend", aliases: ["SCSS"] },

  // Backend
  { name: "Node.js", category: "backend", aliases: ["NodeJS", "Node JS"] },
  { name: "Express.js", category: "backend", aliases: ["ExpressJS"] },
  { name: "Django", category: "backend" },
  { name: "Flask", category: "backend" },
  { name: "FastAPI", category: "backend" },
  { name: "Spring Boot", category: "backend", aliases: ["Spring Framework", "SpringBoot"] },
  { name: ".NET", category: "backend", aliases: ["ASP.NET", "dotnet", ".NET Core"] },
  { name: "Ruby on Rails", category: "backend", cs: ["Rails"] },
  { name: "REST APIs", category: "backend", aliases: ["RESTful", "REST API", "RESTful APIs"], cs: ["REST"] },
  { name: "GraphQL", category: "backend" },
  { name: "gRPC", category: "backend" },
  { name: "Microservices", category: "backend", aliases: ["Microservice"] },

  // Mobile
  { name: "Android", category: "mobile" },
  { name: "iOS", category: "mobile" },
  { name: "React Native", category: "mobile" },
  { name: "Flutter", category: "mobile" },

  // Databases
  { name: "PostgreSQL", category: "database", aliases: ["Postgres"] },
  { name: "MySQL", category: "database" },
  { name: "MongoDB", category: "database", aliases: ["Mongo"] },
  { name: "Redis", category: "database" },
  { name: "SQLite", category: "database" },
  { name: "DynamoDB", category: "database" },
  { name: "Firebase", category: "database" },
  { name: "Supabase", category: "database" },
  { name: "Elasticsearch", category: "database" },
  { name: "Cassandra", category: "database" },

  // Data
  { name: "Pandas", category: "data" },
  { name: "NumPy", category: "data" },
  { name: "Matplotlib", category: "data", aliases: ["Seaborn"] },
  { name: "Data Analysis", category: "data", aliases: ["Data Analytics"] },
  { name: "Data Visualization", category: "data" },
  { name: "Statistics", category: "data", aliases: ["Statistical Analysis"] },
  { name: "Tableau", category: "data" },
  { name: "Power BI", category: "data", aliases: ["PowerBI"] },
  { name: "Excel", category: "data", aliases: ["Microsoft Excel", "MS Excel"], csName: true },
  { name: "Apache Spark", category: "data", aliases: ["PySpark"], cs: ["Spark"] },
  { name: "Hadoop", category: "data" },
  { name: "Kafka", category: "data", aliases: ["Apache Kafka"] },
  { name: "Airflow", category: "data", aliases: ["Apache Airflow"] },
  { name: "ETL", category: "data", aliases: ["ETL pipelines"] },
  { name: "Snowflake", category: "data", csName: true },
  { name: "Databricks", category: "data" },

  // ML / AI
  { name: "Machine Learning", category: "ml", cs: ["ML"] },
  { name: "Deep Learning", category: "ml" },
  { name: "Artificial Intelligence", category: "ml", cs: ["AI"] },
  { name: "NLP", category: "ml", aliases: ["Natural Language Processing"] },
  { name: "Computer Vision", category: "ml" },
  { name: "PyTorch", category: "ml" },
  { name: "TensorFlow", category: "ml" },
  { name: "Keras", category: "ml" },
  { name: "scikit-learn", category: "ml", aliases: ["sklearn", "scikit learn"] },
  { name: "OpenCV", category: "ml" },
  { name: "Hugging Face", category: "ml", aliases: ["HuggingFace"] },
  { name: "LLMs", category: "ml", aliases: ["Large Language Models", "Large Language Model"], cs: ["LLM"] },
  { name: "LangChain", category: "ml" },
  { name: "LangGraph", category: "ml" },
  { name: "RAG", category: "ml", aliases: ["Retrieval-Augmented Generation", "Retrieval Augmented Generation"], csName: true },
  { name: "Generative AI", category: "ml", aliases: ["GenAI", "Gen AI"] },
  { name: "Prompt Engineering", category: "ml" },
  { name: "MLOps", category: "ml" },

  // Cloud / DevOps
  { name: "AWS", category: "cloud", aliases: ["Amazon Web Services"] },
  { name: "GCP", category: "cloud", aliases: ["Google Cloud", "Google Cloud Platform"] },
  { name: "Azure", category: "cloud", aliases: ["Microsoft Azure"] },
  { name: "Docker", category: "devops" },
  { name: "Kubernetes", category: "devops", aliases: ["K8s"] },
  { name: "Terraform", category: "devops" },
  { name: "CI/CD", category: "devops", aliases: ["CI CD", "Continuous Integration"] },
  { name: "Jenkins", category: "devops" },
  { name: "GitHub Actions", category: "devops" },
  { name: "Linux", category: "devops", aliases: ["Unix"] },
  { name: "Nginx", category: "devops" },
  { name: "Vercel", category: "cloud" },

  // Testing
  { name: "Unit Testing", category: "testing", aliases: ["Unit Tests"] },
  { name: "Jest", category: "testing", csName: true },
  { name: "Pytest", category: "testing" },
  { name: "Selenium", category: "testing" },
  { name: "Cypress", category: "testing" },
  { name: "Playwright", category: "testing" },

  // Tools
  { name: "Git", category: "tools" },
  { name: "GitHub", category: "tools" },
  { name: "Jira", category: "tools" },
  { name: "Figma", category: "tools" },
  { name: "Postman", category: "tools" },

  // Concepts
  { name: "Data Structures", category: "concepts", aliases: ["Data Structures and Algorithms"], cs: ["DSA"] },
  { name: "Algorithms", category: "concepts" },
  { name: "System Design", category: "concepts" },
  { name: "OOP", category: "concepts", aliases: ["Object-Oriented Programming", "Object Oriented Programming", "Object-Oriented"] },
  { name: "Operating Systems", category: "concepts" },
  { name: "DBMS", category: "concepts", aliases: ["Database Management Systems"] },
  { name: "Computer Networks", category: "concepts", aliases: ["Networking"] },
  { name: "Distributed Systems", category: "concepts" },
  { name: "Agile", category: "concepts", aliases: ["Scrum"] },
  { name: "Cybersecurity", category: "concepts", aliases: ["Cyber Security", "Information Security"] },
  { name: "Blockchain", category: "other" },
  { name: "Embedded Systems", category: "other", aliases: ["Arduino", "Raspberry Pi"] },
  { name: "Unity", category: "other", csName: true },
  { name: "Unreal Engine", category: "other" },
  { name: "LaTeX", category: "tools" },

  // More languages / web
  { name: "Perl", category: "language" },
  { name: "Haskell", category: "language" },
  { name: "Elixir", category: "language" },
  { name: "Assembly", category: "language", aliases: ["x86 Assembly", "ARM Assembly"] },
  { name: "jQuery", category: "frontend" },
  { name: "Bootstrap", category: "frontend", csName: true },
  { name: "Three.js", category: "frontend", aliases: ["ThreeJS"] },
  { name: "WebSockets", category: "backend", aliases: ["WebSocket", "Socket.IO"] },
  { name: "NestJS", category: "backend", aliases: ["Nest.js"] },
  { name: "Laravel", category: "backend" },
  { name: "Hibernate", category: "backend" },
  { name: "Web Scraping", category: "backend", aliases: ["BeautifulSoup", "Scrapy"] },
  { name: "SwiftUI", category: "mobile" },
  { name: "Jetpack Compose", category: "mobile" },

  // More data / ML
  { name: "BigQuery", category: "data" },
  { name: "Looker", category: "data", csName: true },
  { name: "dbt", category: "data", csName: true },
  { name: "Data Engineering", category: "data" },
  { name: "Data Warehousing", category: "data", aliases: ["Data Warehouse"] },
  { name: "A/B Testing", category: "data", aliases: ["AB Testing"] },
  { name: "XGBoost", category: "ml", aliases: ["LightGBM"] },
  { name: "Reinforcement Learning", category: "ml" },
  { name: "Time Series", category: "ml", aliases: ["Time-Series Forecasting", "Forecasting"] },
  { name: "Feature Engineering", category: "ml" },
  { name: "Vector Databases", category: "ml", aliases: ["Vector Database", "Pinecone", "FAISS", "ChromaDB", "Weaviate"] },
  { name: "Fine-tuning", category: "ml", aliases: ["Fine tuning", "LoRA"] },

  // More cloud / DevOps
  { name: "AWS Lambda", category: "cloud", aliases: ["Serverless"] },
  { name: "EC2", category: "cloud", csName: true },
  { name: "S3", category: "cloud", csName: true },
  { name: "Cloudflare", category: "cloud" },
  { name: "Heroku", category: "cloud" },
  { name: "Ansible", category: "devops" },
  { name: "Prometheus", category: "devops" },
  { name: "Grafana", category: "devops" },
  { name: "Helm", category: "devops", csName: true },

  // Security pack
  { name: "Penetration Testing", category: "security", aliases: ["Pentesting", "Pen Testing", "Ethical Hacking"] },
  { name: "OWASP", category: "security" },
  { name: "Network Security", category: "security" },
  { name: "Cryptography", category: "security" },
  { name: "SIEM", category: "security" },
  { name: "Burp Suite", category: "security" },
  { name: "Wireshark", category: "security" },

  // Design pack
  { name: "UI/UX Design", category: "design", aliases: ["UI/UX", "UX Design", "UI Design", "User Experience", "User Interface Design"], cs: ["UX"] },
  { name: "Adobe XD", category: "design" },
  { name: "Photoshop", category: "design", aliases: ["Adobe Photoshop"] },
  { name: "Illustrator", category: "design", aliases: ["Adobe Illustrator"] },
  { name: "Wireframing", category: "design", aliases: ["Wireframes"] },
  { name: "User Research", category: "design", aliases: ["Usability Testing"] },

  // Business / product pack
  { name: "Product Management", category: "business" },
  { name: "Market Research", category: "business" },
  { name: "Business Analysis", category: "business" },
  { name: "Financial Modeling", category: "business", aliases: ["Financial Modelling"] },
  { name: "Accounting", category: "business" },
  { name: "Valuation", category: "business" },
  { name: "SEO", category: "business", aliases: ["Search Engine Optimization"] },
  { name: "Digital Marketing", category: "business" },
  { name: "Google Analytics", category: "business" },
  { name: "Salesforce", category: "business" },
  { name: "SAP", category: "business", csName: true },

  // Hardware / core-engineering pack
  { name: "VLSI", category: "hardware" },
  { name: "FPGA", category: "hardware" },
  { name: "PCB Design", category: "hardware" },
  { name: "Microcontrollers", category: "hardware", aliases: ["Microcontroller", "STM32", "ESP32"] },
  { name: "IoT", category: "hardware", aliases: ["Internet of Things"], csName: true },
  { name: "ROS", category: "hardware", aliases: ["Robot Operating System"], csName: true },
  { name: "AutoCAD", category: "hardware" },
  { name: "SolidWorks", category: "hardware" },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary regex that also treats + # . as word characters on the left,
 * so "Java" doesn't match inside "JavaScript" and "C++" isn't found in "C+++".
 */
export function termRegex(term: string, caseSensitive = false): RegExp {
  const body = escapeRegex(term).replace(/\\?\s+/g, "[\\s-]+");
  return new RegExp(`(?<![A-Za-z0-9+#.])${body}(?![A-Za-z0-9+#])`, caseSensitive ? "" : "i");
}

interface CompiledSkill {
  name: string;
  category: SkillCategory;
  patterns: RegExp[];
}

const COMPILED: CompiledSkill[] = SKILLS.map((s) => ({
  name: s.name,
  category: s.category,
  patterns: [
    termRegex(s.name, !!s.csName),
    ...(s.aliases ?? []).map((a) => termRegex(a)),
    ...(s.cs ?? []).map((a) => termRegex(a, true)),
  ],
}));

const BY_LOWER = new Map(COMPILED.map((s) => [s.name.toLowerCase(), s]));

export interface SkillHit {
  name: string;
  category: SkillCategory;
  /** lines of the text where the skill appears (evidence) */
  lines: string[];
}

/** Find every taxonomy skill in `text`, with the lines it appears on. */
export function findSkills(text: string): Map<string, SkillHit> {
  const hits = new Map<string, SkillHit>();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    for (const skill of COMPILED) {
      if (skill.patterns.some((p) => p.test(line))) {
        const hit = hits.get(skill.name) ?? { name: skill.name, category: skill.category, lines: [] };
        if (hit.lines.length < 12) hit.lines.push(line);
        hits.set(skill.name, hit);
      }
    }
  }
  return hits;
}

/**
 * Map a free-text skill (e.g. from an LLM) to its canonical taxonomy name.
 * Returns the trimmed input unchanged when it isn't in the taxonomy.
 */
export function canonicalSkill(raw: string): string {
  const trimmed = raw.trim();
  const direct = BY_LOWER.get(trimmed.toLowerCase());
  if (direct) return direct.name;
  for (const skill of COMPILED) {
    if (skill.patterns.some((p) => p.test(trimmed))) {
      // Only accept when the alias covers most of the string ("React" for "React.js"),
      // not when it's one word inside a phrase ("Python scripting for ML pipelines").
      const m = skill.patterns.map((p) => trimmed.match(p)).find(Boolean);
      if (m && m[0].length >= trimmed.length * 0.6) return skill.name;
    }
  }
  return trimmed;
}

/** Patterns for a skill name: taxonomy patterns if known, else a plain term match. */
export function skillPatterns(name: string): RegExp[] {
  return BY_LOWER.get(name.toLowerCase())?.patterns ?? [termRegex(name)];
}

export function skillCategory(name: string): SkillCategory {
  return BY_LOWER.get(name.toLowerCase())?.category ?? "other";
}

export const SKILL_COUNT = SKILLS.length;
