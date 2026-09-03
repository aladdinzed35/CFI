/**
 * CFI — catalogue seed (spec §23, §7).
 *
 * Twelve formations a Meknès training centre could actually run tomorrow:
 * ten published, two still in preparation, spread over the six categories the
 * main seed creates. Every course carries its four locales (fr source, ar, en,
 * es), a real programme of modules and lessons, two or three preview lessons,
 * three learning paths priced below the sum of their parts, and moderated
 * reviews from the demonstration students.
 *
 * ## Idempotency
 * Everything is upserted on a natural key — `Course.slug`, `Path.slug`,
 * `(courseId, order)` for a module, `(moduleId, order)` for a lesson,
 * `(…, locale)` for every translation, `(courseId, userId)` for a review. A
 * second run changes nothing but `updatedAt`. Rows that fell *out* of this file
 * since the last run (a module that used to be sixth, a course dropped from a
 * path) are deleted, so editing the data below is enough — no manual cleanup.
 * Courses that are not in this file at all are left alone: past M2 the admin
 * owns the catalogue and the seed must not eat their work.
 *
 * ## What is deliberately not here
 * - **Video assets.** `videoAssetId` stays null: the centre supplies the real
 *   recordings (§29). A preview lesson of type `ARTICLE` carries its full body,
 *   so the §12.4 preview modal has something true to show from day one.
 * - **Resources.** A downloadable with an invented `sizeBytes` and a storage key
 *   pointing at nothing is a 404 behind a button. They arrive with the files.
 * - **Enrolments and seats.** `enrollmentCount` and `seatsTaken` stay at their
 *   defaults; they are derived from real enrolments (M3/M4). `ratingAvg` and
 *   `ratingCount` *are* recomputed here, from the approved reviews below, which
 *   are real rows.
 */

import {
  CourseLevel,
  CourseStatus,
  DeliveryMode,
  LessonType,
  Locale,
  type Prisma,
  ReviewStatus,
} from '@prisma/client';

// ═══════════════════════════════════════════════════════════════════════════
// Shared shapes
// ═══════════════════════════════════════════════════════════════════════════

/** Structurally the `GroupResult` of `prisma/seed.ts`, without importing it back. */
export interface CatalogGroupResult {
  readonly label: string;
  readonly created: number;
  readonly updated: number;
  readonly preserved: number;
}

const ALL_LOCALES: readonly Locale[] = [Locale.fr, Locale.ar, Locale.en, Locale.es];

const NOW = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/** Counts rows written by one entity, so the run reports something checkable. */
class Counter {
  created = 0;
  updated = 0;

  record(existed: boolean): void {
    if (existed) this.updated += 1;
    else this.created += 1;
  }

  get total(): number {
    return this.created + this.updated;
  }
}

function step(text: string): void {
  console.log(`  · ${text}`);
}

/** Title of a module or a lesson: `fr` is the source, the rest is filled in as it is translated. */
interface PartialText {
  readonly fr: string;
  readonly ar?: string;
  readonly en?: string;
  readonly es?: string;
}

interface SeedLesson {
  readonly title: PartialText;
  readonly type: LessonType;
  /** Minutes a learner should plan for. Feeds `Course.durationMinutes`. */
  readonly minutes: number;
  /** Viewable without an account — the §12.4 conversion lever. */
  readonly isPreview?: boolean;
  /** Defaults to true; false marks a bonus lesson that does not gate completion. */
  readonly isMandatory?: boolean;
  /** MDX body — mandatory in practice for `ARTICLE`, optional notes elsewhere. */
  readonly content?: PartialText;
}

interface SeedModule {
  readonly title: PartialText;
  readonly summary?: PartialText;
  readonly lessons: readonly SeedLesson[];
}

interface SeedCourseText {
  readonly title: string;
  readonly subtitle: string;
  /** MDX. Two short paragraphs at most — the page has an objectives grid above it. */
  readonly description: string;
  readonly objectives: readonly string[];
  readonly audience: readonly string[];
  readonly requirements: readonly string[];
  readonly seoTitle: string;
  readonly seoDescription: string;
}

interface SeedCourse {
  readonly slug: string;
  readonly categorySlug: string;
  /** Null only while the centre is still recruiting the trainer — DRAFT courses. */
  readonly instructorEmail: string | null;
  readonly status: CourseStatus;
  readonly level: CourseLevel;
  readonly deliveryMode: DeliveryMode;
  /** Language the sessions are taught in — not the language of this page. */
  readonly contentLocale: Locale;
  readonly priceCentimes: number;
  readonly comparePriceCentimes?: number;
  readonly installmentCount?: number;
  readonly maxSeats?: number;
  /** Null (omitted) = lifetime access. */
  readonly accessDurationDays?: number;
  readonly passingScore?: number;
  readonly isFeatured?: boolean;
  readonly isNew?: boolean;
  readonly publishedDaysAgo?: number;
  /**
   * Locales where the course text *and* the whole programme are translated.
   * Drives `CourseTranslation.isComplete`, which is what the admin
   * translation-completeness screen reads — so it must not claim more than the
   * modules and lessons below actually deliver.
   */
  readonly completeLocales: readonly Locale[];
  readonly text: Readonly<Record<Locale, SeedCourseText>>;
  readonly modules: readonly SeedModule[];
}

/** Covers live under `public/brand/seed/courses/` — see `public/brand/README.md`. */
function coverKeyFor(slug: string): string {
  return `seed/courses/${slug}.jpg`;
}

// ═══════════════════════════════════════════════════════════════════════════
// The catalogue
// ═══════════════════════════════════════════════════════════════════════════

const COURSES: readonly SeedCourse[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // 1 · Marketing digital : les fondations — fully translated, 4 locales
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'marketing-digital-fondations',
    categorySlug: 'marketing-digital',
    instructorEmail: 'karim.tazi@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.DEBUTANT,
    deliveryMode: DeliveryMode.HYBRIDE,
    contentLocale: Locale.fr,
    priceCentimes: 120_000,
    comparePriceCentimes: 180_000,
    isFeatured: true,
    publishedDaysAgo: 150,
    completeLocales: [Locale.fr, Locale.ar, Locale.en, Locale.es],
    text: {
      fr: {
        title: 'Marketing digital : les fondations',
        subtitle: 'Construire une présence en ligne qui amène de vrais clients',
        description:
          "Cette formation part de votre activité, pas d'une théorie. Vous définissez votre offre et votre audience, vous choisissez les canaux qui vous concernent vraiment, puis vous montez une présence en ligne cohérente : une page qui convertit, des réseaux sociaux tenus, un premier budget publicitaire maîtrisé.\n\nChaque séance se termine par un travail sur votre propre projet, corrigé au centre ou en visioconférence. À la fin, vous repartez avec un plan de communication écrit, un tableau de suivi de vos chiffres et la capacité de décider seul où mettre votre argent le mois suivant.",
        objectives: [
          "Définir une offre claire et l'audience à qui elle s'adresse",
          'Choisir les canaux adaptés à votre activité plutôt que tous les utiliser',
          'Écrire des contenus qui donnent envie de vous contacter',
          'Lancer une première campagne publicitaire avec un budget maîtrisé',
          'Lire vos statistiques et décider quoi arrêter, quoi renforcer',
        ],
        audience: [
          'Commerçants et artisans qui veulent vendre au-delà de leur quartier',
          "Salariés chargés de la communication d'une petite structure",
          'Personnes en reconversion vers les métiers du digital',
        ],
        requirements: [
          'Savoir utiliser un ordinateur et naviguer sur Internet',
          'Un projet ou une activité réelle sur laquelle travailler',
        ],
        seoTitle: 'Formation marketing digital à Meknès — les fondations',
        seoDescription:
          'Formation marketing digital pour débutants à Meknès : offre, audience, réseaux sociaux, publicité en ligne et mesure des résultats. En centre et à distance.',
      },
      ar: {
        title: 'التسويق الرقمي: الأسس',
        subtitle: 'بناء حضور رقمي يجلب زبناء حقيقيين',
        description:
          'تنطلق هذه الدورة التدريبية من نشاطكم أنتم، لا من نظرية عامة. تحدّدون عرضكم وجمهوركم، ثم تختارون القنوات التي تعنيكم فعلاً، وتبنون حضوراً رقمياً منسجماً: صفحة تحوّل الزائر إلى زبون، شبكات اجتماعية مُدارة بانتظام، وميزانية إعلانية أولى تحت السيطرة.\n\nتنتهي كل حصة بعمل على مشروعكم الخاص، يُصحَّح في المركز أو عن بعد. في النهاية تغادرون بخطة تواصل مكتوبة، وجدول لمتابعة أرقامكم، وقدرة على أن تقرّروا بأنفسكم أين تضعون أموالكم في الشهر الموالي.',
        objectives: [
          'تحديد عرض واضح والجمهور الموجَّه إليه',
          'اختيار القنوات المناسبة لنشاطكم بدل استعمالها كلها',
          'كتابة محتوى يدفع القارئ إلى الاتصال بكم',
          'إطلاق حملة إعلانية أولى بميزانية مضبوطة',
          'قراءة إحصائياتكم وتقرير ما يُوقَف وما يُعزَّز',
        ],
        audience: [
          'التجار والحرفيون الراغبون في البيع خارج حيّهم',
          'الموظفون المكلفون بالتواصل داخل بنية صغيرة',
          'الراغبون في إعادة التوجه نحو مهن الرقمي',
        ],
        requirements: [
          'إتقان استعمال الحاسوب والتصفح على الإنترنت',
          'مشروع أو نشاط حقيقي للاشتغال عليه',
        ],
        seoTitle: 'تكوين في التسويق الرقمي بمكناس — الأسس',
        seoDescription:
          'دورة تدريبية في التسويق الرقمي للمبتدئين بمكناس: العرض، الجمهور، الشبكات الاجتماعية، الإعلانات الرقمية وقياس النتائج. حضورياً وعن بعد.',
      },
      en: {
        title: 'Digital marketing: the foundations',
        subtitle: 'Build an online presence that brings in real customers',
        description:
          "This course starts from your business, not from a theory. You define your offer and your audience, pick the channels that actually concern you, then build a coherent online presence: a page that converts, social accounts you can keep up with, and a first advertising budget you stay in control of.\n\nEvery session ends with work on your own project, reviewed at the centre or over video. You leave with a written communication plan, a spreadsheet tracking your numbers, and the ability to decide on your own where next month's money goes.",
        objectives: [
          'Define a clear offer and the audience it speaks to',
          'Pick the channels that fit your business instead of using them all',
          'Write content that makes people want to contact you',
          'Launch a first advertising campaign on a controlled budget',
          'Read your statistics and decide what to stop and what to double down on',
        ],
        audience: [
          'Shop owners and craftspeople who want to sell beyond their neighbourhood',
          'Employees in charge of communication in a small organisation',
          'People retraining towards digital professions',
        ],
        requirements: [
          'Comfortable with a computer and browsing the web',
          'A real project or business to work on',
        ],
        seoTitle: 'Digital marketing training in Meknès — the foundations',
        seoDescription:
          'Beginner digital marketing training in Meknès: offer, audience, social media, online advertising and measuring results. On site and online.',
      },
      es: {
        title: 'Marketing digital: los fundamentos',
        subtitle: 'Crear una presencia en línea que traiga clientes de verdad',
        description:
          'Esta formación parte de su actividad, no de una teoría. Define su oferta y su público, elige los canales que realmente le conciernen y construye una presencia en línea coherente: una página que convierte, redes sociales mantenidas y un primer presupuesto publicitario bajo control.\n\nCada sesión termina con un trabajo sobre su propio proyecto, corregido en el centro o por videoconferencia. Al final se lleva un plan de comunicación escrito, una hoja de seguimiento de sus cifras y la capacidad de decidir solo dónde poner su dinero al mes siguiente.',
        objectives: [
          'Definir una oferta clara y el público al que se dirige',
          'Elegir los canales adecuados a su actividad en lugar de usarlos todos',
          'Escribir contenidos que inviten a contactarle',
          'Lanzar una primera campaña publicitaria con un presupuesto controlado',
          'Leer sus estadísticas y decidir qué parar y qué reforzar',
        ],
        audience: [
          'Comerciantes y artesanos que quieren vender más allá de su barrio',
          'Empleados encargados de la comunicación de una estructura pequeña',
          'Personas en reconversión hacia los oficios digitales',
        ],
        requirements: [
          'Saber usar un ordenador y navegar por Internet',
          'Un proyecto o una actividad real sobre la que trabajar',
        ],
        seoTitle: 'Formación en marketing digital en Meknès — los fundamentos',
        seoDescription:
          'Formación de marketing digital para principiantes en Meknès: oferta, público, redes sociales, publicidad en línea y medición de resultados. Presencial y en línea.',
      },
    },
    modules: [
      {
        title: {
          fr: 'Comprendre le terrain',
          ar: 'فهم الميدان',
          en: 'Understanding the ground',
          es: 'Entender el terreno',
        },
        summary: {
          fr: "Ce que le marketing digital change concrètement pour une activité marocaine, et ce qu'il ne change pas.",
          ar: 'ما يغيّره التسويق الرقمي فعلياً بالنسبة لنشاط مغربي، وما لا يغيّره.',
          en: 'What digital marketing actually changes for a Moroccan business, and what it does not.',
          es: 'Lo que el marketing digital cambia de verdad para una actividad marroquí y lo que no.',
        },
        lessons: [
          {
            title: {
              fr: 'Ce que vous saurez faire à la fin',
              ar: 'ما ستكونون قادرين على إنجازه في النهاية',
              en: 'What you will be able to do by the end',
              es: 'Lo que sabrá hacer al final',
            },
            type: LessonType.VIDEO,
            minutes: 8,
            isPreview: true,
          },
          {
            title: {
              fr: 'Les canaux, sans jargon',
              ar: 'القنوات، بدون مصطلحات معقّدة',
              en: 'The channels, without the jargon',
              es: 'Los canales, sin jerga',
            },
            type: LessonType.VIDEO,
            minutes: 16,
          },
          {
            title: {
              fr: 'Le parcours client, du premier contact à la vente',
              ar: 'رحلة الزبون، من أول اتصال إلى البيع',
              en: 'The customer journey, from first contact to sale',
              es: 'El recorrido del cliente, del primer contacto a la venta',
            },
            type: LessonType.ARTICLE,
            minutes: 12,
            isPreview: true,
            content: {
              fr: "## Personne n'achète au premier passage\n\nEntre le moment où quelqu'un découvre votre nom et celui où il paie, il se passe presque toujours plusieurs contacts : une publication vue, une recherche sur votre nom, un message WhatsApp, un avis lu quelque part.\n\nLe travail consiste à ne perdre personne à chacune de ces étapes :\n\n1. **Découverte** — on vous voit pour la première fois. Une seule chose compte : être compréhensible en trois secondes.\n2. **Intérêt** — on veut en savoir plus. C'est là que votre page, vos photos et vos prix doivent être clairs.\n3. **Décision** — on hésite. Un avis, une réponse rapide et une garantie valent tous les arguments.\n4. **Achat** — le paiement doit être simple et rassurant.\n5. **Fidélité** — un client satisfait qui revient coûte dix fois moins cher qu'un nouveau.\n\nÀ chaque étape, posez-vous la question : *qu'est-ce qui, aujourd'hui, fait qu'une personne s'arrête là et ne va pas plus loin ?* C'est presque toujours cette réponse qu'il faut traiter en premier, avant d'acheter de la publicité.",
              ar: '## لا أحد يشتري من أول زيارة\n\nبين اللحظة التي يكتشف فيها شخص ما اسمكم واللحظة التي يؤدي فيها الثمن، تمرّ عادةً عدة نقاط اتصال: منشور شوهد، بحث عن اسمكم، رسالة على واتساب، رأي قُرئ في مكان ما.\n\nالعمل هو ألّا تفقدوا أحداً في أيٍّ من هذه المراحل:\n\n1. **الاكتشاف** — يراكم الزائر لأول مرة. المهم شيء واحد: أن تكونوا مفهومين في ثلاث ثوان.\n2. **الاهتمام** — يريد معرفة المزيد. هنا يجب أن تكون صفحتكم وصوركم وأثمنتكم واضحة.\n3. **القرار** — يتردّد. رأي زبون، وردّ سريع، وضمان، تساوي كل الحجج.\n4. **الشراء** — يجب أن يكون الأداء بسيطاً ومطمئناً.\n5. **الوفاء** — زبون راضٍ يعود يكلّف عشر مرات أقل من زبون جديد.\n\nفي كل مرحلة اسألوا أنفسكم: *ما الذي يجعل شخصاً اليوم يتوقف هنا ولا يكمل؟* غالباً ما تكون معالجة هذا الجواب أولى من شراء الإعلانات.',
              en: '## Nobody buys on the first visit\n\nBetween the moment someone discovers your name and the moment they pay, there are almost always several contacts: a post seen, a search for your name, a WhatsApp message, a review read somewhere.\n\nThe work is to lose nobody at any of those steps:\n\n1. **Discovery** — they see you for the first time. Only one thing matters: being understandable in three seconds.\n2. **Interest** — they want to know more. This is where your page, your photos and your prices must be clear.\n3. **Decision** — they hesitate. One review, one fast reply and one guarantee beat every argument.\n4. **Purchase** — paying must be simple and reassuring.\n5. **Loyalty** — a satisfied customer who comes back costs ten times less than a new one.\n\nAt every step, ask yourself: *what, today, makes a person stop here and go no further?* Fixing that answer almost always comes before buying advertising.',
              es: '## Nadie compra en la primera visita\n\nEntre el momento en que alguien descubre su nombre y el momento en que paga, casi siempre hay varios contactos: una publicación vista, una búsqueda de su nombre, un mensaje de WhatsApp, una opinión leída en alguna parte.\n\nEl trabajo consiste en no perder a nadie en ninguna de esas etapas:\n\n1. **Descubrimiento** — le ven por primera vez. Solo importa una cosa: ser comprensible en tres segundos.\n2. **Interés** — quieren saber más. Aquí su página, sus fotos y sus precios deben ser claros.\n3. **Decisión** — dudan. Una opinión, una respuesta rápida y una garantía valen más que todos los argumentos.\n4. **Compra** — pagar debe ser sencillo y tranquilizador.\n5. **Fidelidad** — un cliente satisfecho que vuelve cuesta diez veces menos que uno nuevo.\n\nEn cada etapa pregúntese: *¿qué hace hoy que una persona se detenga aquí y no siga?* Resolver esa respuesta casi siempre va antes que comprar publicidad.',
            },
          },
          {
            title: {
              fr: 'Étude de cas : une boutique de Meknès en six mois',
              ar: 'دراسة حالة: محل بمكناس في ستة أشهر',
              en: 'Case study: a Meknès shop over six months',
              es: 'Caso práctico: una tienda de Meknès en seis meses',
            },
            type: LessonType.VIDEO,
            minutes: 18,
          },
          {
            title: {
              fr: 'Atelier : décrire votre activité en une phrase',
              ar: 'ورشة: وصف نشاطكم في جملة واحدة',
              en: 'Workshop: describe your business in one sentence',
              es: 'Taller: describa su actividad en una frase',
            },
            type: LessonType.ASSIGNMENT,
            minutes: 25,
          },
        ],
      },
      {
        title: {
          fr: 'Votre offre et votre audience',
          ar: 'عرضكم وجمهوركم',
          en: 'Your offer and your audience',
          es: 'Su oferta y su público',
        },
        lessons: [
          {
            title: {
              fr: 'À qui vendez-vous vraiment ?',
              ar: 'لمن تبيعون فعلاً؟',
              en: 'Who are you really selling to?',
              es: '¿A quién vende realmente?',
            },
            type: LessonType.VIDEO,
            minutes: 15,
          },
          {
            title: {
              fr: "Construire un persona à partir d'entretiens, pas d'hypothèses",
              ar: 'بناء نموذج الزبون انطلاقاً من مقابلات لا من فرضيات',
              en: 'Build a persona from interviews, not assumptions',
              es: 'Construir un perfil a partir de entrevistas, no de hipótesis',
            },
            type: LessonType.VIDEO,
            minutes: 20,
          },
          {
            title: {
              fr: 'Formuler une promesse que le concurrent ne peut pas copier',
              ar: 'صياغة وعد لا يستطيع المنافس نسخه',
              en: 'Phrase a promise a competitor cannot copy',
              es: 'Formular una promesa que la competencia no pueda copiar',
            },
            type: LessonType.VIDEO,
            minutes: 17,
          },
          {
            title: {
              fr: 'Fixer un prix et savoir le défendre',
              ar: 'تحديد الثمن والقدرة على الدفاع عنه',
              en: 'Set a price and be able to defend it',
              es: 'Fijar un precio y saber defenderlo',
            },
            type: LessonType.VIDEO,
            minutes: 19,
          },
          {
            title: {
              fr: 'Quiz : offre, audience, promesse',
              ar: 'اختبار: العرض والجمهور والوعد',
              en: 'Quiz: offer, audience, promise',
              es: 'Cuestionario: oferta, público, promesa',
            },
            type: LessonType.QUIZ,
            minutes: 10,
          },
        ],
      },
      {
        title: {
          fr: 'La présence qui travaille pour vous',
          ar: 'الحضور الذي يشتغل لصالحكم',
          en: 'A presence that works for you',
          es: 'La presencia que trabaja por usted',
        },
        lessons: [
          {
            title: {
              fr: 'Fiche Google Business : le canal gratuit que tout le monde oublie',
              ar: 'بطاقة Google Business: القناة المجانية التي ينساها الجميع',
              en: 'Google Business profile: the free channel everyone forgets',
              es: 'Ficha de Google Business: el canal gratuito que todos olvidan',
            },
            type: LessonType.VIDEO,
            minutes: 22,
          },
          {
            title: {
              fr: 'Une page qui convertit : structure et preuves',
              ar: 'صفحة تحوّل الزائر: البنية والأدلة',
              en: 'A page that converts: structure and proof',
              es: 'Una página que convierte: estructura y pruebas',
            },
            type: LessonType.VIDEO,
            minutes: 24,
          },
          {
            title: {
              fr: 'Instagram et Facebook : tenir un rythme réaliste',
              ar: 'إنستغرام وفيسبوك: الحفاظ على إيقاع واقعي',
              en: 'Instagram and Facebook: keeping a realistic rhythm',
              es: 'Instagram y Facebook: mantener un ritmo realista',
            },
            type: LessonType.VIDEO,
            minutes: 21,
          },
          {
            title: {
              fr: 'WhatsApp Business : répondre vite sans y passer la journée',
              ar: 'واتساب للأعمال: الردّ بسرعة دون قضاء اليوم كله',
              en: 'WhatsApp Business: replying fast without losing your day',
              es: 'WhatsApp Business: responder rápido sin perder el día',
            },
            type: LessonType.VIDEO,
            minutes: 18,
          },
          {
            title: {
              fr: 'Atelier : votre calendrier éditorial du mois',
              ar: 'ورشة: رزنامة المحتوى الخاصة بشهركم',
              en: 'Workshop: your editorial calendar for the month',
              es: 'Taller: su calendario editorial del mes',
            },
            type: LessonType.ASSIGNMENT,
            minutes: 30,
          },
        ],
      },
      {
        title: {
          fr: 'Attirer : contenu et publicité',
          ar: 'الاستقطاب: المحتوى والإعلان',
          en: 'Attracting: content and advertising',
          es: 'Atraer: contenido y publicidad',
        },
        lessons: [
          {
            title: {
              fr: 'Écrire pour être lu : titres, accroches, appels à l’action',
              ar: 'الكتابة لكي تُقرأ: العناوين والمقدمات ودعوات الفعل',
              en: 'Writing to be read: titles, hooks, calls to action',
              es: 'Escribir para ser leído: títulos, ganchos, llamadas a la acción',
            },
            type: LessonType.VIDEO,
            minutes: 23,
          },
          {
            title: {
              fr: 'Photographier ses produits avec un téléphone',
              ar: 'تصوير المنتجات بالهاتف',
              en: 'Photographing your products with a phone',
              es: 'Fotografiar sus productos con un teléfono',
            },
            type: LessonType.VIDEO,
            minutes: 20,
          },
          {
            title: {
              fr: 'Première campagne : 300 DH pour apprendre',
              ar: 'الحملة الأولى: 300 درهم للتعلّم',
              en: 'First campaign: 300 DH to learn',
              es: 'Primera campaña: 300 DH para aprender',
            },
            type: LessonType.VIDEO,
            minutes: 26,
          },
          {
            title: {
              fr: 'Le référencement local, expliqué simplement',
              ar: 'تحسين الظهور المحلي، بشرح مبسّط',
              en: 'Local search, explained simply',
              es: 'El posicionamiento local, explicado con sencillez',
            },
            type: LessonType.ARTICLE,
            minutes: 14,
            isPreview: true,
            content: {
              fr: "## Être trouvé quand on vous cherche à côté de chez vous\n\nLa majorité des recherches qui mènent à un achat sont locales : « coiffeur Meknès », « imprimerie près de moi », « cours d'anglais Hamria ». Trois choses pèsent, dans cet ordre :\n\n- **La fiche Google Business** : complète, avec les vraies horaires, des photos récentes et une catégorie exacte.\n- **Les avis** : leur nombre, leur fraîcheur, et le fait que vous répondiez — y compris aux avis négatifs, calmement.\n- **La cohérence de vos coordonnées** : le même nom, la même adresse et le même numéro partout où vous êtes cité.\n\nCe travail ne coûte rien d'autre que du temps, et il produit des demandes pendant des années. Faites-le avant d'ouvrir un compte publicitaire.",
              ar: '## أن تُوجَدوا حين يبحث عنكم الناس بجواركم\n\nأغلب عمليات البحث المؤدية إلى شراء هي بحث محلي: «حلاق مكناس»، «مطبعة قربي»، «دروس الإنجليزية مالاباطا». ثلاثة عناصر تزن، بهذا الترتيب:\n\n- **بطاقة Google Business**: كاملة، بأوقات عمل حقيقية، وصور حديثة، وفئة دقيقة.\n- **الآراء**: عددها، وحداثتها، وكونكم تردّون عليها — بما فيها السلبية، بهدوء.\n- **انسجام معطياتكم**: نفس الاسم ونفس العنوان ونفس الرقم في كل مكان تُذكرون فيه.\n\nهذا العمل لا يكلّف سوى الوقت، وينتج طلبات لسنوات. أنجزوه قبل فتح حساب إعلاني.',
              en: '## Being found when people search next door\n\nMost searches that lead to a purchase are local: "hairdresser Meknès", "printer near me", "English lessons Hamria". Three things weigh, in this order:\n\n- **The Google Business profile**: complete, with real opening hours, recent photos and an exact category.\n- **Reviews**: how many, how recent, and whether you reply — including calmly to negative ones.\n- **Consistent details**: the same name, address and phone number everywhere you are listed.\n\nThis work costs nothing but time and produces enquiries for years. Do it before opening an ad account.',
              es: '## Que le encuentren cuando le buscan al lado de casa\n\nLa mayoría de las búsquedas que llevan a una compra son locales: «peluquería Meknès», «imprenta cerca de mí», «clases de inglés Hamria». Pesan tres cosas, en este orden:\n\n- **La ficha de Google Business**: completa, con horarios reales, fotos recientes y una categoría exacta.\n- **Las opiniones**: cuántas, cómo de recientes y si usted responde — también con calma a las negativas.\n- **La coherencia de sus datos**: el mismo nombre, la misma dirección y el mismo teléfono en todas partes.\n\nEste trabajo no cuesta más que tiempo y genera solicitudes durante años. Hágalo antes de abrir una cuenta publicitaria.',
            },
          },
        ],
      },
      {
        title: {
          fr: 'Mesurer et décider',
          ar: 'القياس واتخاذ القرار',
          en: 'Measure and decide',
          es: 'Medir y decidir',
        },
        lessons: [
          {
            title: {
              fr: 'Les cinq chiffres qui suffisent',
              ar: 'الأرقام الخمسة التي تكفي',
              en: 'The five numbers that are enough',
              es: 'Las cinco cifras que bastan',
            },
            type: LessonType.VIDEO,
            minutes: 18,
          },
          {
            title: {
              fr: 'Installer une mesure honnête de vos résultats',
              ar: 'إرساء قياس صادق لنتائجكم',
              en: 'Set up an honest measurement of your results',
              es: 'Instalar una medición honesta de sus resultados',
            },
            type: LessonType.VIDEO,
            minutes: 22,
          },
          {
            title: {
              fr: 'Combien vous coûte un client, et combien il vous rapporte',
              ar: 'كم يكلّفكم الزبون وكم يدرّ عليكم',
              en: 'What a customer costs you, and what they bring you',
              es: 'Cuánto le cuesta un cliente y cuánto le aporta',
            },
            type: LessonType.VIDEO,
            minutes: 20,
          },
          {
            title: {
              fr: 'Projet final : votre plan de communication sur trois mois',
              ar: 'المشروع الختامي: خطة تواصلكم على ثلاثة أشهر',
              en: 'Final project: your three-month communication plan',
              es: 'Proyecto final: su plan de comunicación a tres meses',
            },
            type: LessonType.ASSIGNMENT,
            minutes: 45,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2 · Publicité en ligne : Meta Ads et Google Ads — programme fr + ar
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'publicite-en-ligne-meta-et-google-ads',
    categorySlug: 'marketing-digital',
    instructorEmail: 'karim.tazi@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.INTERMEDIAIRE,
    deliveryMode: DeliveryMode.EN_LIGNE,
    contentLocale: Locale.fr,
    priceCentimes: 240_000,
    comparePriceCentimes: 320_000,
    maxSeats: 20,
    accessDurationDays: 365,
    isFeatured: true,
    publishedDaysAgo: 118,
    completeLocales: [Locale.fr],
    text: {
      fr: {
        title: 'Publicité en ligne : Meta Ads et Google Ads',
        subtitle: 'Dépenser 100 DH et savoir exactement ce qu’ils ont rapporté',
        description:
          "Une formation d'exploitation, pas de découverte : vous ouvrez les comptes publicitaires, vous structurez les campagnes, vous installez le suivi des conversions et vous apprenez à arbitrer un budget semaine après semaine.\n\nLes séances se font compte publicitaire ouvert, sur des campagnes réelles. Vous travaillez sur votre propre budget — un minimum de 500 DH de dépense publicitaire sur la durée est recommandé pour que les exercices produisent des données exploitables.",
        objectives: [
          'Structurer un compte publicitaire lisible : campagnes, ensembles, annonces',
          'Installer le suivi des conversions et vérifier qu’il remonte les bonnes actions',
          'Écrire et tester des annonces sans épuiser le budget en apprentissage',
          'Lire un rapport et décider quoi couper, quoi augmenter',
          'Construire une audience de reciblage propre',
        ],
        audience: [
          'Responsables marketing qui gèrent déjà un budget publicitaire',
          'E-commerçants qui veulent reprendre la main sur leurs campagnes',
          'Freelances qui facturent la gestion de campagnes à leurs clients',
        ],
        requirements: [
          'Avoir suivi une initiation au marketing digital ou une expérience équivalente',
          'Un compte Meta Business et un moyen de paiement en ligne',
          'Un budget publicitaire de test, même modeste',
        ],
        seoTitle: 'Formation Meta Ads et Google Ads à Meknès',
        seoDescription:
          'Formation publicité en ligne : structurer un compte, suivre les conversions, tester des annonces et arbitrer un budget sur Meta Ads et Google Ads.',
      },
      ar: {
        title: 'الإعلانات الرقمية: Meta Ads وGoogle Ads',
        subtitle: 'أن تنفقوا 100 درهم وتعرفوا بالضبط ماذا أعادت لكم',
        description:
          'دورة تدريبية تطبيقية لا تمهيدية: تفتحون الحسابات الإعلانية، وتنظّمون الحملات، وتركّبون تتبع التحويلات، وتتعلّمون توزيع الميزانية أسبوعاً بعد أسبوع.\n\nتجري الحصص والحساب الإعلاني مفتوح، على حملات حقيقية. تشتغلون بميزانيتكم الخاصة — ويُنصح بإنفاق إعلاني لا يقل عن 500 درهم طوال الدورة حتى تنتج التمارين معطيات قابلة للاستثمار.',
        objectives: [
          'تنظيم حساب إعلاني واضح: الحملات والمجموعات والإعلانات',
          'تركيب تتبع التحويلات والتأكد من أنه يسجّل الأفعال الصحيحة',
          'كتابة الإعلانات واختبارها دون استنزاف الميزانية في التعلّم',
          'قراءة التقرير وتقرير ما يُوقَف وما تُرفع ميزانيته',
          'بناء جمهور إعادة استهداف نظيف',
        ],
        audience: [
          'مسؤولو التسويق الذين يديرون ميزانية إعلانية بالفعل',
          'أصحاب المتاجر الإلكترونية الراغبون في استعادة التحكم في حملاتهم',
          'المستقلّون الذين يفوترون تدبير الحملات لزبنائهم',
        ],
        requirements: [
          'متابعة تكوين تمهيدي في التسويق الرقمي أو تجربة معادلة',
          'حساب Meta Business ووسيلة أداء إلكترونية',
          'ميزانية إعلانية للتجريب، ولو متواضعة',
        ],
        seoTitle: 'تكوين في Meta Ads وGoogle Ads بمكناس',
        seoDescription:
          'دورة تدريبية في الإعلانات الرقمية: تنظيم الحساب، تتبع التحويلات، اختبار الإعلانات وتوزيع الميزانية على Meta Ads وGoogle Ads.',
      },
      en: {
        title: 'Online advertising: Meta Ads and Google Ads',
        subtitle: 'Spend 100 DH and know exactly what it brought back',
        description:
          'An operating course, not an introduction: you open the ad accounts, structure the campaigns, install conversion tracking and learn to arbitrate a budget week after week.\n\nSessions run with the ad account open, on real campaigns. You work on your own budget — at least 500 DH of ad spend over the course is recommended so the exercises produce usable data.',
        objectives: [
          'Structure a readable ad account: campaigns, ad sets, ads',
          'Install conversion tracking and check that it reports the right actions',
          'Write and test ads without burning the budget on learning',
          'Read a report and decide what to cut and what to scale',
          'Build a clean retargeting audience',
        ],
        audience: [
          'Marketing managers already running an advertising budget',
          'Online sellers who want to take back control of their campaigns',
          'Freelancers who bill campaign management to their clients',
        ],
        requirements: [
          'An introduction to digital marketing or equivalent experience',
          'A Meta Business account and an online payment method',
          'A test advertising budget, however modest',
        ],
        seoTitle: 'Meta Ads and Google Ads training in Meknès',
        seoDescription:
          'Online advertising training: account structure, conversion tracking, ad testing and budget arbitration on Meta Ads and Google Ads.',
      },
      es: {
        title: 'Publicidad en línea: Meta Ads y Google Ads',
        subtitle: 'Gastar 100 DH y saber exactamente qué han rendido',
        description:
          'Una formación de explotación, no de descubrimiento: abre las cuentas publicitarias, estructura las campañas, instala el seguimiento de conversiones y aprende a repartir un presupuesto semana tras semana.\n\nLas sesiones se hacen con la cuenta publicitaria abierta, sobre campañas reales. Trabaja con su propio presupuesto — se recomienda un gasto publicitario mínimo de 500 DH durante la formación para que los ejercicios produzcan datos aprovechables.',
        objectives: [
          'Estructurar una cuenta publicitaria legible: campañas, conjuntos, anuncios',
          'Instalar el seguimiento de conversiones y comprobar que registra las acciones correctas',
          'Escribir y probar anuncios sin agotar el presupuesto aprendiendo',
          'Leer un informe y decidir qué cortar y qué aumentar',
          'Construir un público de remarketing limpio',
        ],
        audience: [
          'Responsables de marketing que ya gestionan un presupuesto publicitario',
          'Vendedores en línea que quieren recuperar el control de sus campañas',
          'Autónomos que facturan la gestión de campañas a sus clientes',
        ],
        requirements: [
          'Haber hecho una iniciación al marketing digital o experiencia equivalente',
          'Una cuenta de Meta Business y un medio de pago en línea',
          'Un presupuesto publicitario de prueba, aunque sea modesto',
        ],
        seoTitle: 'Formación en Meta Ads y Google Ads en Meknès',
        seoDescription:
          'Formación en publicidad en línea: estructura de cuenta, seguimiento de conversiones, prueba de anuncios y reparto de presupuesto en Meta Ads y Google Ads.',
      },
    },
    modules: [
      {
        title: {
          fr: 'Poser les fondations du compte',
          ar: 'إرساء أسس الحساب',
        },
        lessons: [
          {
            title: { fr: 'Ce que la publicité peut et ne peut pas faire', ar: 'ما يستطيع الإعلان فعله وما لا يستطيع' },
            type: LessonType.VIDEO,
            minutes: 12,
            isPreview: true,
          },
          {
            title: { fr: 'Business Manager : comptes, accès, moyens de paiement', ar: 'Business Manager: الحسابات والصلاحيات ووسائل الأداء' },
            type: LessonType.VIDEO,
            minutes: 20,
          },
          {
            title: { fr: 'Le pixel et les conversions, sans se mentir', ar: 'البكسل والتحويلات، دون خداع الذات' },
            type: LessonType.VIDEO,
            minutes: 26,
          },
          {
            title: { fr: 'Nommer ses campagnes pour s’y retrouver dans six mois', ar: 'تسمية الحملات لتجدوا طريقكم بعد ستة أشهر' },
            type: LessonType.ARTICLE,
            minutes: 10,
            isPreview: true,
            content: {
              fr: "## Une convention de nommage vaut mieux qu'une bonne mémoire\n\nAu bout de trois mois, un compte publicitaire contient des dizaines de campagnes. Sans convention, plus personne ne sait laquelle a produit quoi.\n\nUn schéma qui tient : `objectif_audience_offre_date`.\n\n- `conv_retarget_pack-hiver_2026-01`\n- `trafic_froid_page-tarifs_2026-02`\n\nTrois règles suffisent : minuscules, tirets bas entre les blocs, jamais d'espace ni d'accent. Vous pourrez filtrer, trier et exporter sans réécrire quoi que ce soit.",
              ar: '## اصطلاح للتسمية خير من ذاكرة جيدة\n\nبعد ثلاثة أشهر يحتوي الحساب الإعلاني على عشرات الحملات. بدون اصطلاح، لن يعرف أحد أيّها أنتج ماذا.\n\nصيغة عملية: `الهدف_الجمهور_العرض_التاريخ`.\n\n- `conv_retarget_pack-hiver_2026-01`\n- `trafic_froid_page-tarifs_2026-02`\n\nثلاث قواعد تكفي: حروف صغيرة، شرطة سفلية بين الكتل، ولا فراغات ولا رموز خاصة. عندها يمكنكم الفرز والتصفية والتصدير دون إعادة كتابة أي شيء.',
            },
          },
        ],
      },
      {
        title: { fr: 'Meta Ads en production', ar: 'Meta Ads في الإنتاج' },
        lessons: [
          {
            title: { fr: 'Choisir un objectif de campagne et s’y tenir', ar: 'اختيار هدف الحملة والالتزام به' },
            type: LessonType.VIDEO,
            minutes: 18,
          },
          {
            title: { fr: 'Audiences : froides, similaires, reciblage', ar: 'الجماهير: الباردة، المشابهة، إعادة الاستهداف' },
            type: LessonType.VIDEO,
            minutes: 24,
          },
          {
            title: { fr: 'Créations : trois angles, cinq formats', ar: 'التصاميم: ثلاث زوايا، خمسة صيغ' },
            type: LessonType.VIDEO,
            minutes: 22,
          },
          {
            title: { fr: 'Tester sans gaspiller : la règle des 50 conversions', ar: 'الاختبار دون تبذير: قاعدة الخمسين تحويلاً' },
            type: LessonType.VIDEO,
            minutes: 19,
          },
          {
            title: { fr: 'Atelier : lancer votre campagne de test', ar: 'ورشة: إطلاق حملتكم التجريبية' },
            type: LessonType.ASSIGNMENT,
            minutes: 40,
          },
        ],
      },
      {
        title: { fr: 'Google Ads : capter la demande existante', ar: 'Google Ads: التقاط الطلب القائم' },
        lessons: [
          {
            title: { fr: 'Recherche, Display, Performance Max : lequel, quand', ar: 'البحث، العرض، Performance Max: أيّها ومتى' },
            type: LessonType.VIDEO,
            minutes: 21,
          },
          {
            title: { fr: 'Mots-clés et intentions d’achat', ar: 'الكلمات المفتاحية ونيّات الشراء' },
            type: LessonType.VIDEO,
            minutes: 23,
          },
          {
            title: { fr: 'Annonces responsives et extensions', ar: 'الإعلانات التفاعلية والإضافات' },
            type: LessonType.VIDEO,
            minutes: 17,
          },
          {
            title: { fr: 'Mots-clés à exclure : le poste d’économie le plus rapide', ar: 'الكلمات المستبعدة: أسرع باب للاقتصاد' },
            type: LessonType.VIDEO,
            minutes: 15,
          },
          {
            title: { fr: 'Quiz : structure de compte et enchères', ar: 'اختبار: بنية الحساب والمزايدة' },
            type: LessonType.QUIZ,
            minutes: 12,
          },
        ],
      },
      {
        title: { fr: 'Arbitrer un budget', ar: 'تدبير الميزانية' },
        lessons: [
          {
            title: { fr: 'Le rapport hebdomadaire en dix minutes', ar: 'التقرير الأسبوعي في عشر دقائق' },
            type: LessonType.VIDEO,
            minutes: 20,
          },
          {
            title: { fr: 'Coût par acquisition, retour sur dépense, marge', ar: 'كلفة الاكتساب، العائد على الإنفاق، الهامش' },
            type: LessonType.VIDEO,
            minutes: 25,
          },
          {
            title: { fr: 'Quand augmenter, quand couper, quand ne rien faire', ar: 'متى تزيدون، متى توقفون، ومتى لا تفعلون شيئاً' },
            type: LessonType.VIDEO,
            minutes: 18,
          },
          {
            title: { fr: 'Projet final : audit et plan média du trimestre', ar: 'المشروع الختامي: تدقيق وخطة إعلامية للفصل' },
            type: LessonType.ASSIGNMENT,
            minutes: 50,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 3 · Développement web : les fondations — fully translated, 4 locales
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'developpement-web-html-css-javascript',
    categorySlug: 'developpement-web',
    instructorEmail: 'nadia.ouazzani@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.DEBUTANT,
    deliveryMode: DeliveryMode.HYBRIDE,
    contentLocale: Locale.fr,
    priceCentimes: 290_000,
    comparePriceCentimes: 360_000,
    installmentCount: 2,
    maxSeats: 18,
    isFeatured: true,
    publishedDaysAgo: 140,
    completeLocales: [Locale.fr, Locale.ar, Locale.en, Locale.es],
    text: {
      fr: {
        title: 'Développement web : HTML, CSS et JavaScript',
        subtitle: 'Écrire du code, le mettre en ligne, et comprendre ce qu’on a écrit',
        description:
          "Trois mois pour passer de zéro à un site que vous avez construit, hébergé et que vous savez modifier. On écrit du code dès la première séance : structure HTML, mise en page CSS moderne, interactions en JavaScript, puis mise en ligne réelle.\n\nLe rythme est celui d'un groupe de dix-huit personnes maximum, avec un projet fil rouge choisi par chaque participant et une revue de code à chaque module. Le certificat est délivré sur le projet livré, pas sur un questionnaire.",
        objectives: [
          'Structurer une page en HTML sémantique et accessible',
          'Mettre en page avec Flexbox et Grid, du mobile au grand écran',
          'Rendre une interface vivante avec JavaScript, sans bibliothèque',
          'Utiliser Git au quotidien et publier sur un hébergement réel',
          'Lire un message d’erreur et corriger seul ce qui ne marche pas',
        ],
        audience: [
          'Débutants complets décidés à changer de métier',
          'Étudiants qui veulent un portfolio avant leur stage',
          'Graphistes qui veulent intégrer eux-mêmes leurs maquettes',
        ],
        requirements: [
          'Un ordinateur portable que vous apportez aux séances',
          'Aucune connaissance en programmation n’est nécessaire',
          'Trois à cinq heures de travail personnel par semaine',
        ],
        seoTitle: 'Formation développement web à Meknès — HTML, CSS, JavaScript',
        seoDescription:
          'Formation développement web pour débutants à Meknès : HTML, CSS, JavaScript, Git et mise en ligne. Groupe limité à 18, projet final évalué.',
      },
      ar: {
        title: 'تطوير الويب: HTML وCSS وJavaScript',
        subtitle: 'أن تكتبوا الشيفرة، وتنشروها، وتفهموا ما كتبتم',
        description:
          'ثلاثة أشهر للانتقال من الصفر إلى موقع بنيتموه واستضفتموه وتعرفون كيف تعدّلونه. نكتب الشيفرة منذ الحصة الأولى: بنية HTML، تنسيق حديث بـCSS، تفاعلات بـJavaScript، ثم نشر حقيقي على الإنترنت.\n\nالإيقاع إيقاع مجموعة لا تتجاوز ثمانية عشر مشاركاً، مع مشروع مرافق يختاره كل مشارك ومراجعة للشيفرة عند نهاية كل وحدة. تُسلَّم الشهادة على أساس المشروع المنجَز، لا على أساس استمارة.',
        objectives: [
          'بناء صفحة بـHTML دلالي وقابل للولوج',
          'التنسيق باستعمال Flexbox وGrid، من الهاتف إلى الشاشة الكبيرة',
          'إضفاء الحياة على الواجهة بـJavaScript، دون مكتبات',
          'استعمال Git يومياً والنشر على استضافة حقيقية',
          'قراءة رسالة الخطأ وإصلاح ما لا يشتغل بأنفسكم',
        ],
        audience: [
          'المبتدئون تماماً العازمون على تغيير المهنة',
          'الطلبة الراغبون في ملف أعمال قبل التدريب',
          'المصممون الراغبون في تحويل تصاميمهم بأنفسهم',
        ],
        requirements: [
          'حاسوب محمول تحضرونه إلى الحصص',
          'لا حاجة إلى أي معرفة سابقة بالبرمجة',
          'من ثلاث إلى خمس ساعات عمل شخصي أسبوعياً',
        ],
        seoTitle: 'تكوين في تطوير الويب بمكناس — HTML وCSS وJavaScript',
        seoDescription:
          'دورة تدريبية في تطوير الويب للمبتدئين بمكناس: HTML وCSS وJavaScript وGit والنشر. مجموعة محدودة في 18 مشاركاً ومشروع ختامي مقيَّم.',
      },
      en: {
        title: 'Web development: HTML, CSS and JavaScript',
        subtitle: 'Write code, put it online, and understand what you wrote',
        description:
          'Three months to go from zero to a site you built, hosted and can modify. You write code from the first session: HTML structure, modern CSS layout, JavaScript interaction, then a real deployment.\n\nThe pace is that of a group of eighteen people at most, with a running project chosen by each participant and a code review at every module. The certificate is awarded on the delivered project, not on a questionnaire.',
        objectives: [
          'Structure a page in semantic, accessible HTML',
          'Lay out with Flexbox and Grid, from mobile to wide screens',
          'Bring an interface to life with JavaScript, without a library',
          'Use Git daily and publish to real hosting',
          'Read an error message and fix what is broken on your own',
        ],
        audience: [
          'Complete beginners set on changing career',
          'Students who want a portfolio before their internship',
          'Graphic designers who want to build their own mockups',
        ],
        requirements: [
          'A laptop you bring to the sessions',
          'No programming knowledge required',
          'Three to five hours of personal work a week',
        ],
        seoTitle: 'Web development training in Meknès — HTML, CSS, JavaScript',
        seoDescription:
          'Beginner web development training in Meknès: HTML, CSS, JavaScript, Git and deployment. Groups capped at 18, assessed final project.',
      },
      es: {
        title: 'Desarrollo web: HTML, CSS y JavaScript',
        subtitle: 'Escribir código, publicarlo y entender lo que ha escrito',
        description:
          'Tres meses para pasar de cero a un sitio que usted ha construido, alojado y sabe modificar. Se escribe código desde la primera sesión: estructura HTML, maquetación moderna con CSS, interacción con JavaScript y publicación real.\n\nEl ritmo es el de un grupo de dieciocho personas como máximo, con un proyecto continuo elegido por cada participante y una revisión de código en cada módulo. El certificado se entrega por el proyecto presentado, no por un cuestionario.',
        objectives: [
          'Estructurar una página en HTML semántico y accesible',
          'Maquetar con Flexbox y Grid, del móvil a la pantalla grande',
          'Dar vida a una interfaz con JavaScript, sin bibliotecas',
          'Usar Git a diario y publicar en un alojamiento real',
          'Leer un mensaje de error y corregir por su cuenta lo que falla',
        ],
        audience: [
          'Principiantes absolutos decididos a cambiar de oficio',
          'Estudiantes que quieren un portafolio antes de las prácticas',
          'Diseñadores gráficos que quieren maquetar ellos mismos',
        ],
        requirements: [
          'Un ordenador portátil que traiga a las sesiones',
          'No se necesita ningún conocimiento de programación',
          'De tres a cinco horas de trabajo personal por semana',
        ],
        seoTitle: 'Formación en desarrollo web en Meknès — HTML, CSS, JavaScript',
        seoDescription:
          'Formación en desarrollo web para principiantes en Meknès: HTML, CSS, JavaScript, Git y publicación. Grupos de 18 y proyecto final evaluado.',
      },
    },
    modules: [
      {
        title: {
          fr: 'Le web, vu de l’intérieur',
          ar: 'الويب، من الداخل',
          en: 'The web, from the inside',
          es: 'La web, vista por dentro',
        },
        lessons: [
          {
            title: {
              fr: 'Ce que vous aurez construit à la fin',
              ar: 'ما ستكونون قد بنيتموه في النهاية',
              en: 'What you will have built by the end',
              es: 'Lo que habrá construido al final',
            },
            type: LessonType.VIDEO,
            minutes: 9,
            isPreview: true,
          },
          {
            title: {
              fr: 'Ce qui se passe entre l’adresse tapée et la page affichée',
              ar: 'ما يحدث بين كتابة العنوان وظهور الصفحة',
              en: 'What happens between the typed address and the page',
              es: 'Qué ocurre entre la dirección escrita y la página mostrada',
            },
            type: LessonType.ARTICLE,
            minutes: 14,
            isPreview: true,
            content: {
              fr: "## Une requête, une réponse, rien de magique\n\nQuand vous tapez une adresse, quatre choses s'enchaînent :\n\n1. **La résolution du nom** — le navigateur demande à un annuaire (DNS) l'adresse IP qui se cache derrière `cfi.ma`.\n2. **La connexion** — il ouvre une connexion sécurisée vers ce serveur.\n3. **La requête** — il envoie une phrase très courte : `GET / HTTP/1.1`.\n4. **La réponse** — le serveur renvoie un statut (`200`, `404`, `500`), des en-têtes, puis le HTML.\n\nLe navigateur lit ensuite ce HTML de haut en bas, télécharge les fichiers CSS et JavaScript qu'il rencontre, et dessine la page.\n\nRetenez ceci : **tout ce que vous verrez dans cette formation se passe soit dans cette réponse, soit dans ce que le navigateur en fait.** Il n'y a pas de troisième endroit.",
              ar: '## طلب، وجواب، ولا شيء سحري\n\nحين تكتبون عنواناً، تتسلسل أربعة أمور:\n\n1. **ترجمة الاسم** — يسأل المتصفح دليلاً (DNS) عن عنوان IP المختبئ خلف `cfi.ma`.\n2. **الاتصال** — يفتح اتصالاً مؤمَّناً بذلك الخادم.\n3. **الطلب** — يرسل جملة قصيرة جداً: `GET / HTTP/1.1`.\n4. **الجواب** — يعيد الخادم رمز حالة (`200`، `404`، `500`) وترويسات ثم HTML.\n\nبعدها يقرأ المتصفح هذا الـHTML من الأعلى إلى الأسفل، ويحمّل ملفات CSS وJavaScript التي يصادفها، ويرسم الصفحة.\n\nاحفظوا هذا: **كل ما ستشاهدونه في هذه الدورة يحدث إما داخل هذا الجواب أو فيما يفعله المتصفح به.** لا يوجد مكان ثالث.',
              en: '## One request, one response, nothing magical\n\nWhen you type an address, four things follow one another:\n\n1. **Name resolution** — the browser asks a directory (DNS) for the IP address behind `cfi.ma`.\n2. **The connection** — it opens a secure connection to that server.\n3. **The request** — it sends a very short sentence: `GET / HTTP/1.1`.\n4. **The response** — the server returns a status (`200`, `404`, `500`), headers, then HTML.\n\nThe browser then reads that HTML top to bottom, downloads the CSS and JavaScript files it meets, and paints the page.\n\nRemember this: **everything you will see in this course happens either inside that response or in what the browser does with it.** There is no third place.',
              es: '## Una petición, una respuesta, nada mágico\n\nCuando escribe una dirección, se encadenan cuatro cosas:\n\n1. **La resolución del nombre** — el navegador pide a un directorio (DNS) la dirección IP que hay detrás de `cfi.ma`.\n2. **La conexión** — abre una conexión segura hacia ese servidor.\n3. **La petición** — envía una frase muy corta: `GET / HTTP/1.1`.\n4. **La respuesta** — el servidor devuelve un estado (`200`, `404`, `500`), cabeceras y luego el HTML.\n\nDespués el navegador lee ese HTML de arriba abajo, descarga los archivos CSS y JavaScript que encuentra y dibuja la página.\n\nRecuerde esto: **todo lo que verá en esta formación ocurre o dentro de esa respuesta o en lo que el navegador hace con ella.** No hay un tercer lugar.',
            },
          },
          {
            title: {
              fr: 'Installer son poste de travail',
              ar: 'إعداد محطة العمل',
              en: 'Setting up your workstation',
              es: 'Preparar su puesto de trabajo',
            },
            type: LessonType.VIDEO,
            minutes: 18,
          },
          {
            title: {
              fr: 'Les outils de développement du navigateur',
              ar: 'أدوات التطوير في المتصفح',
              en: 'The browser developer tools',
              es: 'Las herramientas de desarrollo del navegador',
            },
            type: LessonType.VIDEO,
            minutes: 16,
            isPreview: true,
          },
        ],
      },
      {
        title: {
          fr: 'HTML : la structure avant tout',
          ar: 'HTML: البنية قبل كل شيء',
          en: 'HTML: structure first',
          es: 'HTML: la estructura ante todo',
        },
        lessons: [
          {
            title: {
              fr: 'Balises, attributs, arborescence',
              ar: 'الوسوم والخصائص والشجرة',
              en: 'Tags, attributes, tree',
              es: 'Etiquetas, atributos, árbol',
            },
            type: LessonType.VIDEO,
            minutes: 20,
          },
          {
            title: {
              fr: 'Écrire du HTML sémantique',
              ar: 'كتابة HTML دلالي',
              en: 'Writing semantic HTML',
              es: 'Escribir HTML semántico',
            },
            type: LessonType.VIDEO,
            minutes: 22,
          },
          {
            title: {
              fr: 'Formulaires et champs accessibles',
              ar: 'الاستمارات والحقول القابلة للولوج',
              en: 'Forms and accessible fields',
              es: 'Formularios y campos accesibles',
            },
            type: LessonType.VIDEO,
            minutes: 24,
          },
          {
            title: {
              fr: 'Images, médias et poids des pages',
              ar: 'الصور والوسائط ووزن الصفحات',
              en: 'Images, media and page weight',
              es: 'Imágenes, medios y peso de las páginas',
            },
            type: LessonType.VIDEO,
            minutes: 19,
          },
          {
            title: {
              fr: 'Atelier : la structure de votre projet',
              ar: 'ورشة: بنية مشروعكم',
              en: 'Workshop: the structure of your project',
              es: 'Taller: la estructura de su proyecto',
            },
            type: LessonType.ASSIGNMENT,
            minutes: 45,
          },
        ],
      },
      {
        title: {
          fr: 'CSS : la mise en page moderne',
          ar: 'CSS: التنسيق الحديث',
          en: 'CSS: modern layout',
          es: 'CSS: la maquetación moderna',
        },
        lessons: [
          {
            title: {
              fr: 'Sélecteurs, cascade et héritage',
              ar: 'المحدِّدات والتتالي والوراثة',
              en: 'Selectors, cascade and inheritance',
              es: 'Selectores, cascada y herencia',
            },
            type: LessonType.VIDEO,
            minutes: 21,
          },
          {
            title: {
              fr: 'Le modèle de boîte, une bonne fois pour toutes',
              ar: 'نموذج الصندوق، مرة واحدة وإلى الأبد',
              en: 'The box model, once and for all',
              es: 'El modelo de caja, de una vez por todas',
            },
            type: LessonType.VIDEO,
            minutes: 18,
          },
          {
            title: {
              fr: 'Flexbox : aligner sans souffrir',
              ar: 'Flexbox: المحاذاة دون معاناة',
              en: 'Flexbox: aligning without pain',
              es: 'Flexbox: alinear sin sufrir',
            },
            type: LessonType.VIDEO,
            minutes: 26,
          },
          {
            title: {
              fr: 'Grid : les vraies mises en page',
              ar: 'Grid: التخطيطات الحقيقية',
              en: 'Grid: real layouts',
              es: 'Grid: las maquetaciones de verdad',
            },
            type: LessonType.VIDEO,
            minutes: 28,
          },
          {
            title: {
              fr: 'Responsive : penser petit écran d’abord',
              ar: 'التجاوب: التفكير في الشاشة الصغيرة أولاً',
              en: 'Responsive: small screen first',
              es: 'Responsive: pensar primero en la pantalla pequeña',
            },
            type: LessonType.VIDEO,
            minutes: 24,
          },
          {
            title: {
              fr: 'Quiz : sélecteurs, boîte, flux',
              ar: 'اختبار: المحدِّدات والصندوق والتدفق',
              en: 'Quiz: selectors, box, flow',
              es: 'Cuestionario: selectores, caja, flujo',
            },
            type: LessonType.QUIZ,
            minutes: 12,
          },
        ],
      },
      {
        title: {
          fr: 'JavaScript : rendre la page vivante',
          ar: 'JavaScript: إضفاء الحياة على الصفحة',
          en: 'JavaScript: making the page alive',
          es: 'JavaScript: dar vida a la página',
        },
        lessons: [
          {
            title: {
              fr: 'Variables, types, conditions, boucles',
              ar: 'المتغيرات والأنواع والشروط والحلقات',
              en: 'Variables, types, conditions, loops',
              es: 'Variables, tipos, condiciones, bucles',
            },
            type: LessonType.VIDEO,
            minutes: 30,
          },
          {
            title: {
              fr: 'Fonctions et organisation du code',
              ar: 'الدوال وتنظيم الشيفرة',
              en: 'Functions and code organisation',
              es: 'Funciones y organización del código',
            },
            type: LessonType.VIDEO,
            minutes: 25,
          },
          {
            title: {
              fr: 'Manipuler le DOM et écouter les événements',
              ar: 'التعامل مع DOM والإنصات للأحداث',
              en: 'Manipulating the DOM and listening to events',
              es: 'Manipular el DOM y escuchar eventos',
            },
            type: LessonType.VIDEO,
            minutes: 27,
          },
          {
            title: {
              fr: 'Appeler une API et afficher le résultat',
              ar: 'استدعاء واجهة برمجية وعرض النتيجة',
              en: 'Calling an API and displaying the result',
              es: 'Llamar a una API y mostrar el resultado',
            },
            type: LessonType.VIDEO,
            minutes: 29,
          },
          {
            title: {
              fr: 'Déboguer : lire l’erreur au lieu de la craindre',
              ar: 'تصحيح الأخطاء: اقرأوا الخطأ بدل الخوف منه',
              en: 'Debugging: read the error instead of fearing it',
              es: 'Depurar: leer el error en lugar de temerlo',
            },
            type: LessonType.VIDEO,
            minutes: 20,
          },
        ],
      },
      {
        title: {
          fr: 'Livrer et maintenir',
          ar: 'التسليم والصيانة',
          en: 'Ship and maintain',
          es: 'Entregar y mantener',
        },
        lessons: [
          {
            title: {
              fr: 'Git et GitHub au quotidien',
              ar: 'Git وGitHub في الاستعمال اليومي',
              en: 'Git and GitHub day to day',
              es: 'Git y GitHub en el día a día',
            },
            type: LessonType.VIDEO,
            minutes: 26,
          },
          {
            title: {
              fr: 'Mettre en ligne sur un hébergement réel',
              ar: 'النشر على استضافة حقيقية',
              en: 'Deploying to real hosting',
              es: 'Publicar en un alojamiento real',
            },
            type: LessonType.VIDEO,
            minutes: 23,
          },
          {
            title: {
              fr: 'Performance et accessibilité : la vérification finale',
              ar: 'الأداء وقابلية الولوج: التحقق النهائي',
              en: 'Performance and accessibility: the final check',
              es: 'Rendimiento y accesibilidad: la comprobación final',
            },
            type: LessonType.VIDEO,
            minutes: 22,
          },
          {
            title: {
              fr: 'Projet final : votre site, en ligne, défendu devant le groupe',
              ar: 'المشروع الختامي: موقعكم، منشوراً، ومدافَعاً عنه أمام المجموعة',
              en: 'Final project: your site, online, defended before the group',
              es: 'Proyecto final: su sitio, en línea, defendido ante el grupo',
            },
            type: LessonType.ASSIGNMENT,
            minutes: 60,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 4 · React et Next.js — programme fr (traduction du programme à venir)
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'react-et-next-js-applications-web',
    categorySlug: 'developpement-web',
    instructorEmail: 'nadia.ouazzani@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.AVANCE,
    deliveryMode: DeliveryMode.EN_LIGNE,
    contentLocale: Locale.fr,
    priceCentimes: 390_000,
    installmentCount: 3,
    passingScore: 75,
    publishedDaysAgo: 84,
    completeLocales: [Locale.fr],
    text: {
      fr: {
        title: 'React et Next.js : applications web modernes',
        subtitle: 'Passer du site à l’application, et la tenir en production',
        description:
          "La suite logique de la formation fondations : composants, état, routage, rendu serveur, base de données et déploiement. On construit une application complète — authentification, formulaires validés, tableau de bord — en écrivant le même code qu'en entreprise.\n\nLes séances sont en visioconférence, en petit groupe, avec une revue de code hebdomadaire sur votre dépôt. Prévoyez un vrai temps de travail entre les séances : c'est une formation exigeante.",
        objectives: [
          'Découper une interface en composants réutilisables et typés',
          'Gérer l’état local et l’état serveur sans les confondre',
          'Construire des routes et des formulaires validés côté serveur',
          'Lire et écrire dans une base de données depuis l’application',
          'Déployer, surveiller et corriger une application en production',
        ],
        audience: [
          'Développeurs qui maîtrisent déjà JavaScript et veulent structurer leurs projets',
          'Intégrateurs qui veulent passer au développement applicatif',
          'Anciens participants de la formation fondations',
        ],
        requirements: [
          'JavaScript courant : fonctions, tableaux, promesses',
          'Git et la ligne de commande au quotidien',
          'Six à huit heures de travail personnel par semaine',
        ],
        seoTitle: 'Formation React et Next.js à Meknès',
        seoDescription:
          'Formation avancée React et Next.js : composants, état, rendu serveur, base de données, authentification et déploiement en production.',
      },
      ar: {
        title: 'React وNext.js: تطبيقات ويب حديثة',
        subtitle: 'الانتقال من الموقع إلى التطبيق، والحفاظ عليه في الإنتاج',
        description:
          'الامتداد المنطقي لدورة الأسس: المكوّنات، الحالة، التوجيه، العرض من الخادم، قاعدة البيانات والنشر. نبني تطبيقاً كاملاً — مصادقة، استمارات مُتحقَّق منها، لوحة قيادة — بكتابة الشيفرة نفسها المستعملة في المقاولات.\n\nتجري الحصص عن بعد في مجموعة صغيرة، مع مراجعة أسبوعية للشيفرة على مستودعكم. خصّصوا وقتاً حقيقياً للعمل بين الحصص: هذه دورة تدريبية متطلِّبة.',
        objectives: [
          'تقسيم الواجهة إلى مكوّنات قابلة لإعادة الاستعمال ومحدَّدة الأنواع',
          'تدبير الحالة المحلية وحالة الخادم دون الخلط بينهما',
          'بناء المسارات والاستمارات مع تحقق من جهة الخادم',
          'القراءة والكتابة في قاعدة بيانات انطلاقاً من التطبيق',
          'النشر والمراقبة وإصلاح تطبيق في الإنتاج',
        ],
        audience: [
          'المطوّرون المتمكّنون من JavaScript والراغبون في هيكلة مشاريعهم',
          'المدمِجون الراغبون في الانتقال إلى تطوير التطبيقات',
          'خرّيجو دورة الأسس',
        ],
        requirements: [
          'إتقان JavaScript: الدوال والمصفوفات والوعود',
          'استعمال Git وسطر الأوامر يومياً',
          'من ست إلى ثماني ساعات عمل شخصي أسبوعياً',
        ],
        seoTitle: 'تكوين في React وNext.js بمكناس',
        seoDescription:
          'دورة تدريبية متقدمة في React وNext.js: المكوّنات، الحالة، العرض من الخادم، قاعدة البيانات، المصادقة والنشر في الإنتاج.',
      },
      en: {
        title: 'React and Next.js: modern web applications',
        subtitle: 'From site to application, and keeping it in production',
        description:
          'The logical follow-up to the foundations course: components, state, routing, server rendering, database and deployment. You build a complete application — authentication, validated forms, dashboard — writing the same code as in a company.\n\nSessions are online, in a small group, with a weekly code review on your repository. Plan real work between sessions: this is a demanding course.',
        objectives: [
          'Split an interface into reusable, typed components',
          'Handle local state and server state without confusing them',
          'Build routes and forms validated on the server',
          'Read from and write to a database from the application',
          'Deploy, monitor and fix an application in production',
        ],
        audience: [
          'Developers comfortable with JavaScript who want to structure their projects',
          'Front-end integrators moving into application development',
          'Graduates of the foundations course',
        ],
        requirements: [
          'Fluent JavaScript: functions, arrays, promises',
          'Git and the command line on a daily basis',
          'Six to eight hours of personal work a week',
        ],
        seoTitle: 'React and Next.js training in Meknès',
        seoDescription:
          'Advanced React and Next.js training: components, state, server rendering, database, authentication and production deployment.',
      },
      es: {
        title: 'React y Next.js: aplicaciones web modernas',
        subtitle: 'Pasar del sitio a la aplicación y sostenerla en producción',
        description:
          'La continuación lógica de la formación de fundamentos: componentes, estado, enrutado, renderizado en servidor, base de datos y despliegue. Se construye una aplicación completa — autenticación, formularios validados, panel — escribiendo el mismo código que en una empresa.\n\nLas sesiones son en línea, en grupo reducido, con una revisión de código semanal sobre su repositorio. Reserve tiempo real de trabajo entre sesiones: es una formación exigente.',
        objectives: [
          'Dividir una interfaz en componentes reutilizables y tipados',
          'Gestionar el estado local y el estado del servidor sin confundirlos',
          'Construir rutas y formularios validados en el servidor',
          'Leer y escribir en una base de datos desde la aplicación',
          'Desplegar, supervisar y corregir una aplicación en producción',
        ],
        audience: [
          'Desarrolladores que dominan JavaScript y quieren estructurar sus proyectos',
          'Maquetadores que quieren pasar al desarrollo de aplicaciones',
          'Antiguos participantes de la formación de fundamentos',
        ],
        requirements: [
          'JavaScript fluido: funciones, arrays, promesas',
          'Git y la línea de comandos a diario',
          'De seis a ocho horas de trabajo personal por semana',
        ],
        seoTitle: 'Formación en React y Next.js en Meknès',
        seoDescription:
          'Formación avanzada en React y Next.js: componentes, estado, renderizado en servidor, base de datos, autenticación y despliegue en producción.',
      },
    },
    modules: [
      {
        title: { fr: 'Penser en composants' },
        lessons: [
          { title: { fr: 'Pourquoi React, et à quel prix' }, type: LessonType.VIDEO, minutes: 14, isPreview: true },
          { title: { fr: 'JSX, propriétés, composition' }, type: LessonType.VIDEO, minutes: 24 },
          { title: { fr: 'TypeScript pour typer une interface' }, type: LessonType.VIDEO, minutes: 28 },
          { title: { fr: 'Listes, clés et rendus conditionnels' }, type: LessonType.VIDEO, minutes: 20 },
          { title: { fr: 'Atelier : découper une maquette' }, type: LessonType.ASSIGNMENT, minutes: 40 },
        ],
      },
      {
        title: { fr: 'État et effets' },
        lessons: [
          { title: { fr: 'useState : ce qui change, et où le ranger' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'useEffect : le piège le plus courant' }, type: LessonType.VIDEO, minutes: 26 },
          { title: { fr: 'Remonter l’état, ou pas' }, type: LessonType.VIDEO, minutes: 19 },
          { title: { fr: 'Formulaires contrôlés et validation' }, type: LessonType.VIDEO, minutes: 25 },
          { title: { fr: 'Quiz : état local et rendu' }, type: LessonType.QUIZ, minutes: 12 },
        ],
      },
      {
        title: { fr: 'Next.js : le rendu côté serveur' },
        lessons: [
          {
            title: { fr: 'Composants serveur et composants client' },
            type: LessonType.ARTICLE,
            minutes: 16,
            isPreview: true,
            content: {
              fr: "## La question à se poser pour chaque composant\n\nDans une application Next.js moderne, un composant est **serveur** par défaut. Il s'exécute une fois, sur le serveur, et n'envoie au navigateur que du HTML. Il peut lire la base de données directement, et son code ne part jamais chez l'utilisateur.\n\nUn composant **client** — marqué par `'use client'` en première ligne — est envoyé au navigateur. C'est ce qui permet l'état, les effets et les gestionnaires d'événements, et c'est ce qui alourdit la page.\n\nLa règle pratique : *écrivez tout en serveur, et ne passez en client que la plus petite feuille de l'arbre qui a réellement besoin d'interactivité.* Un bouton qui ouvre un menu n'oblige pas la page entière à devenir cliente.\n\nCette seule discipline explique la plus grande partie de l'écart de performance entre deux applications qui font pourtant la même chose.",
            },
          },
          { title: { fr: 'Routage par fichiers et mise en page imbriquée' }, type: LessonType.VIDEO, minutes: 23 },
          { title: { fr: 'Récupérer des données et gérer le cache' }, type: LessonType.VIDEO, minutes: 27 },
          { title: { fr: 'Actions serveur et validation' }, type: LessonType.VIDEO, minutes: 30 },
          { title: { fr: 'États de chargement et d’erreur' }, type: LessonType.VIDEO, minutes: 18 },
        ],
      },
      {
        title: { fr: 'Données et authentification' },
        lessons: [
          { title: { fr: 'Modéliser sa base et écrire ses requêtes' }, type: LessonType.VIDEO, minutes: 32 },
          { title: { fr: 'Sessions, rôles, autorisations' }, type: LessonType.VIDEO, minutes: 28 },
          { title: { fr: 'Téléversement de fichiers' }, type: LessonType.VIDEO, minutes: 21 },
          { title: { fr: 'Atelier : le tableau de bord de votre application' }, type: LessonType.ASSIGNMENT, minutes: 50 },
        ],
      },
      {
        title: { fr: 'Mise en production' },
        lessons: [
          { title: { fr: 'Variables d’environnement et secrets' }, type: LessonType.VIDEO, minutes: 16 },
          { title: { fr: 'Déploiement sur un hébergement mutualisé' }, type: LessonType.VIDEO, minutes: 26 },
          { title: { fr: 'Mesurer les performances réelles' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'Projet final : application complète en production' }, type: LessonType.ASSIGNMENT, minutes: 90 },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 5 · UI/UX — programme fr
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'ui-ux-concevoir-des-interfaces-utilisables',
    categorySlug: 'design-creation',
    instructorEmail: 'nadia.ouazzani@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.INTERMEDIAIRE,
    deliveryMode: DeliveryMode.EN_LIGNE,
    contentLocale: Locale.fr,
    priceCentimes: 220_000,
    comparePriceCentimes: 280_000,
    publishedDaysAgo: 71,
    completeLocales: [Locale.fr],
    text: {
      fr: {
        title: 'UI/UX : concevoir des interfaces utilisables',
        subtitle: 'De l’intention de l’utilisateur à l’écran qu’on peut coder',
        description:
          "Concevoir n'est pas décorer. Cette formation suit le chemin complet : comprendre ce que la personne vient faire, structurer l'information, dessiner les écrans dans Figma, tester avec de vrais utilisateurs, puis remettre au développement une maquette exploitable.\n\nOn travaille sur un cas unique du début à la fin : une application de services de proximité, avec ses contraintes réelles — connexion lente, écran de téléphone, texte en français et en arabe.",
        objectives: [
          'Mener des entretiens utilisateurs courts et en tirer des décisions',
          'Structurer un parcours et une arborescence avant de dessiner',
          'Construire une maquette dans Figma avec des composants réutilisables',
          'Poser une grille, une typographie et des contrastes accessibles',
          'Tester une maquette et corriger ce que le test révèle',
        ],
        audience: [
          'Graphistes qui veulent aller vers le produit numérique',
          'Développeurs qui conçoivent seuls leurs interfaces',
          'Chefs de projet qui doivent arbitrer des choix de conception',
        ],
        requirements: [
          'Un compte Figma gratuit',
          'Une culture visuelle de base — pas de niveau requis en dessin',
        ],
        seoTitle: 'Formation UI/UX design à Meknès — Figma et ergonomie',
        seoDescription:
          'Formation UI/UX : recherche utilisateur, parcours, maquettes Figma, systèmes de composants, accessibilité et tests d’utilisabilité.',
      },
      ar: {
        title: 'تجربة وواجهة المستخدم: تصميم واجهات قابلة للاستعمال',
        subtitle: 'من نيّة المستعمل إلى شاشة قابلة للبرمجة',
        description:
          'التصميم ليس تزييناً. تتبع هذه الدورة التدريبية المسار كاملاً: فهم ما جاء الشخص لإنجازه، هيكلة المعلومة، رسم الشاشات في Figma، الاختبار مع مستعملين حقيقيين، ثم تسليم نموذج قابل للاستثمار إلى فريق التطوير.\n\nنشتغل على حالة واحدة من البداية إلى النهاية: تطبيق لخدمات القرب، بإكراهاته الواقعية — اتصال بطيء، شاشة هاتف، ونصّ بالفرنسية والعربية.',
        objectives: [
          'إجراء مقابلات قصيرة مع المستعملين واستخلاص قرارات منها',
          'هيكلة المسار وشجرة المحتوى قبل الرسم',
          'بناء نموذج في Figma بمكوّنات قابلة لإعادة الاستعمال',
          'وضع شبكة وخطوط وتباينات قابلة للولوج',
          'اختبار النموذج وتصحيح ما يكشفه الاختبار',
        ],
        audience: [
          'المصممون الراغبون في التوجه نحو المنتج الرقمي',
          'المطوّرون الذين يصمّمون واجهاتهم بأنفسهم',
          'رؤساء المشاريع المطالبون بالحسم في خيارات التصميم',
        ],
        requirements: ['حساب Figma مجاني', 'ثقافة بصرية أساسية — لا مستوى مطلوب في الرسم'],
        seoTitle: 'تكوين في تصميم واجهات المستخدم بمكناس — Figma والإرغونوميا',
        seoDescription:
          'دورة تدريبية في تجربة وواجهة المستخدم: البحث مع المستعملين، المسارات، نماذج Figma، أنظمة المكوّنات، قابلية الولوج والاختبارات.',
      },
      en: {
        title: 'UI/UX: designing usable interfaces',
        subtitle: 'From user intent to a screen that can be coded',
        description:
          'Designing is not decorating. This course follows the whole path: understand what the person came to do, structure the information, draw the screens in Figma, test with real users, then hand development a mockup they can build.\n\nWe work on a single case from start to finish: a local-services application, with its real constraints — slow connection, phone screen, text in French and Arabic.',
        objectives: [
          'Run short user interviews and turn them into decisions',
          'Structure a journey and an information tree before drawing',
          'Build a Figma mockup with reusable components',
          'Set a grid, a type scale and accessible contrasts',
          'Test a mockup and fix what the test reveals',
        ],
        audience: [
          'Graphic designers moving towards digital product work',
          'Developers who design their own interfaces',
          'Project managers who must arbitrate design decisions',
        ],
        requirements: ['A free Figma account', 'Basic visual culture — no drawing skill required'],
        seoTitle: 'UI/UX design training in Meknès — Figma and usability',
        seoDescription:
          'UI/UX training: user research, journeys, Figma mockups, component systems, accessibility and usability testing.',
      },
      es: {
        title: 'UI/UX: diseñar interfaces utilizables',
        subtitle: 'De la intención del usuario a la pantalla que se puede programar',
        description:
          'Diseñar no es decorar. Esta formación recorre el camino completo: entender a qué viene la persona, estructurar la información, dibujar las pantallas en Figma, probar con usuarios reales y entregar al equipo de desarrollo una maqueta aprovechable.\n\nTrabajamos sobre un único caso de principio a fin: una aplicación de servicios de proximidad, con sus limitaciones reales — conexión lenta, pantalla de móvil y texto en francés y árabe.',
        objectives: [
          'Realizar entrevistas breves con usuarios y extraer decisiones',
          'Estructurar un recorrido y un árbol de información antes de dibujar',
          'Construir una maqueta en Figma con componentes reutilizables',
          'Definir una retícula, una tipografía y contrastes accesibles',
          'Probar una maqueta y corregir lo que revela la prueba',
        ],
        audience: [
          'Diseñadores gráficos que quieren ir hacia el producto digital',
          'Desarrolladores que diseñan solos sus interfaces',
          'Jefes de proyecto que deben arbitrar decisiones de diseño',
        ],
        requirements: ['Una cuenta gratuita de Figma', 'Cultura visual básica — no se exige nivel de dibujo'],
        seoTitle: 'Formación en diseño UI/UX en Meknès — Figma y usabilidad',
        seoDescription:
          'Formación UI/UX: investigación con usuarios, recorridos, maquetas en Figma, sistemas de componentes, accesibilidad y pruebas de usabilidad.',
      },
    },
    modules: [
      {
        title: { fr: 'Comprendre avant de dessiner' },
        lessons: [
          { title: { fr: 'Ce que ce métier fait vraiment' }, type: LessonType.VIDEO, minutes: 11, isPreview: true },
          { title: { fr: 'Entretiens utilisateurs : cinq personnes suffisent' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'Transformer des verbatims en décisions' }, type: LessonType.VIDEO, minutes: 18 },
          { title: { fr: 'Parcours utilisateur et points de friction' }, type: LessonType.VIDEO, minutes: 20 },
        ],
      },
      {
        title: { fr: 'Structurer l’information' },
        lessons: [
          { title: { fr: 'Arborescence et nommage' }, type: LessonType.VIDEO, minutes: 19 },
          { title: { fr: 'Wireframes : dessiner laid, vite, et jeter' }, type: LessonType.VIDEO, minutes: 21 },
          { title: { fr: 'Hiérarchie visuelle : ce que l’œil lit en premier' }, type: LessonType.VIDEO, minutes: 17 },
          { title: { fr: 'Atelier : le parcours de votre cas' }, type: LessonType.ASSIGNMENT, minutes: 40 },
        ],
      },
      {
        title: { fr: 'Figma en production' },
        lessons: [
          { title: { fr: 'Grilles, espacements, échelle typographique' }, type: LessonType.VIDEO, minutes: 24 },
          { title: { fr: 'Composants, variantes et propriétés' }, type: LessonType.VIDEO, minutes: 28 },
          { title: { fr: 'Styles, variables et thème sombre' }, type: LessonType.VIDEO, minutes: 23 },
          { title: { fr: 'Prototyper une interaction' }, type: LessonType.VIDEO, minutes: 20 },
          { title: { fr: 'Quiz : système de composants' }, type: LessonType.QUIZ, minutes: 10 },
        ],
      },
      {
        title: { fr: 'Accessibilité et bilinguisme' },
        lessons: [
          {
            title: { fr: 'Concevoir une interface qui se retourne en arabe' },
            type: LessonType.ARTICLE,
            minutes: 15,
            isPreview: true,
            content: {
              fr: "## Le miroir n'est pas total\n\nEn arabe, la lecture va de droite à gauche : la mise en page se retourne. Ce qui se retourne, et ce qui ne se retourne pas :\n\n**Se retourne** — l'ordre des colonnes, l'alignement des textes, les marges intérieures et extérieures, les flèches de navigation « suivant » et « précédent », les barres de progression.\n\n**Ne se retourne jamais** — un logo, une photo, une icône de lecture ou de pause (le sens de lecture d'une bande vidéo est universel), un numéro de téléphone, un prix, une date, une adresse e-mail, un RIB.\n\nEn maquette, la conséquence pratique est simple : raisonnez en **début** et **fin** plutôt qu'en gauche et droite, dès le wireframe. Une maquette pensée ainsi se retourne en une commande ; une maquette pensée en « gauche/droite » se redessine entièrement.",
            },
          },
          { title: { fr: 'Contrastes, tailles de cible, focus visible' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'Tester une maquette avec cinq personnes' }, type: LessonType.VIDEO, minutes: 19 },
          { title: { fr: 'Projet final : maquette testée et remise au développement' }, type: LessonType.ASSIGNMENT, minutes: 60 },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 6 · Montage vidéo — DRAFT, ouverture prévue à la rentrée
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'montage-video-formats-courts',
    categorySlug: 'design-creation',
    instructorEmail: 'karim.tazi@cfi.ma',
    status: CourseStatus.DRAFT,
    level: CourseLevel.TOUS_NIVEAUX,
    deliveryMode: DeliveryMode.PRESENTIEL,
    contentLocale: Locale.fr,
    priceCentimes: 160_000,
    maxSeats: 12,
    completeLocales: [Locale.fr],
    text: {
      fr: {
        title: 'Montage vidéo : Reels, Shorts et formats courts',
        subtitle: 'Tourner au téléphone, monter proprement, publier au bon format',
        description:
          "Une formation courte et entièrement pratique, au centre, sur le matériel du centre. On filme, on monte, on publie : cadrage, lumière disponible, son correct, rythme, sous-titres, exports aux bons formats.\n\nLe programme ci-dessous est en cours de finalisation ; les dates d'ouverture seront annoncées avant la rentrée.",
        objectives: [
          'Tourner une séquence exploitable avec un téléphone',
          'Monter au rythme du format court sans effets inutiles',
          'Ajouter des sous-titres lisibles, y compris en arabe',
          'Exporter au bon format pour chaque réseau',
        ],
        audience: [
          'Commerçants qui filment déjà leurs produits',
          'Chargés de communication sans budget de production',
          'Créateurs de contenu débutants',
        ],
        requirements: [
          'Un téléphone récent avec de l’espace de stockage libre',
          'Aucune expérience du montage n’est nécessaire',
        ],
        seoTitle: 'Formation montage vidéo formats courts à Meknès',
        seoDescription:
          'Formation pratique au montage vidéo pour Reels et Shorts : tournage au téléphone, montage, sous-titres et export. En présentiel à Meknès.',
      },
      ar: {
        title: 'المونتاج: Reels وShorts والصيغ القصيرة',
        subtitle: 'التصوير بالهاتف، المونتاج بإتقان، النشر بالصيغة المناسبة',
        description:
          'دورة تدريبية قصيرة وتطبيقية بالكامل، في المركز وبمعدّاته. نصوّر، نركّب، ننشر: التأطير، الضوء المتاح، صوت سليم، الإيقاع، الترجمة المكتوبة، والتصدير بالصيغ المناسبة.\n\nالبرنامج أسفله في طور الإتمام؛ وستُعلن تواريخ الانطلاق قبل الدخول.',
        objectives: [
          'تصوير مقطع قابل للاستثمار بهاتف',
          'المونتاج بإيقاع الصيغ القصيرة دون مؤثرات زائدة',
          'إضافة ترجمة مكتوبة واضحة، بما فيها العربية',
          'التصدير بالصيغة المناسبة لكل شبكة',
        ],
        audience: [
          'التجار الذين يصوّرون منتجاتهم بالفعل',
          'المكلّفون بالتواصل بدون ميزانية إنتاج',
          'صنّاع المحتوى المبتدئون',
        ],
        requirements: ['هاتف حديث بمساحة تخزين متاحة', 'لا حاجة إلى أي تجربة سابقة في المونتاج'],
        seoTitle: 'تكوين في مونتاج الصيغ القصيرة بمكناس',
        seoDescription:
          'دورة تطبيقية في المونتاج لـReels وShorts: التصوير بالهاتف، التركيب، الترجمة المكتوبة والتصدير. حضورياً بمكناس.',
      },
      en: {
        title: 'Video editing: Reels, Shorts and short formats',
        subtitle: 'Shoot on a phone, edit cleanly, publish in the right format',
        description:
          "A short, entirely hands-on course at the centre, on the centre's equipment. You shoot, edit and publish: framing, available light, decent sound, rhythm, subtitles, exports in the right formats.\n\nThe programme below is being finalised; opening dates will be announced before the new term.",
        objectives: [
          'Shoot usable footage with a phone',
          'Edit to the rhythm of short formats without pointless effects',
          'Add legible subtitles, including in Arabic',
          'Export in the right format for each network',
        ],
        audience: [
          'Shop owners who already film their products',
          'Communication officers with no production budget',
          'Beginner content creators',
        ],
        requirements: ['A recent phone with free storage', 'No editing experience required'],
        seoTitle: 'Short-form video editing training in Meknès',
        seoDescription:
          'Hands-on video editing training for Reels and Shorts: phone shooting, editing, subtitles and export. On site in Meknès.',
      },
      es: {
        title: 'Edición de vídeo: Reels, Shorts y formatos cortos',
        subtitle: 'Grabar con el móvil, editar con limpieza, publicar en el formato correcto',
        description:
          'Una formación corta y totalmente práctica, en el centro y con el material del centro. Se graba, se edita y se publica: encuadre, luz disponible, sonido correcto, ritmo, subtítulos y exportación en los formatos adecuados.\n\nEl programa que figura debajo está en fase de cierre; las fechas de apertura se anunciarán antes del inicio del curso.',
        objectives: [
          'Grabar una secuencia aprovechable con un teléfono',
          'Editar al ritmo del formato corto sin efectos inútiles',
          'Añadir subtítulos legibles, también en árabe',
          'Exportar en el formato adecuado para cada red',
        ],
        audience: [
          'Comerciantes que ya graban sus productos',
          'Responsables de comunicación sin presupuesto de producción',
          'Creadores de contenido principiantes',
        ],
        requirements: ['Un teléfono reciente con espacio libre', 'No se necesita experiencia en edición'],
        seoTitle: 'Formación en edición de vídeo de formato corto en Meknès',
        seoDescription:
          'Formación práctica de edición de vídeo para Reels y Shorts: grabación con móvil, montaje, subtítulos y exportación. Presencial en Meknès.',
      },
    },
    modules: [
      {
        title: { fr: 'Tourner avec ce qu’on a' },
        lessons: [
          { title: { fr: 'Préparer un tournage en quinze minutes' }, type: LessonType.VIDEO, minutes: 14 },
          { title: { fr: 'Cadrage, stabilité, lumière disponible' }, type: LessonType.VIDEO, minutes: 18 },
          { title: { fr: 'Le son, moitié de la vidéo' }, type: LessonType.VIDEO, minutes: 16 },
          { title: { fr: 'Atelier de tournage au centre' }, type: LessonType.ASSIGNMENT, minutes: 60 },
        ],
      },
      {
        title: { fr: 'Monter au bon rythme' },
        lessons: [
          { title: { fr: 'Dérushage et sélection' }, type: LessonType.VIDEO, minutes: 20 },
          { title: { fr: 'Coupes, transitions, musique' }, type: LessonType.VIDEO, minutes: 24 },
          { title: { fr: 'Sous-titres lisibles, français et arabe' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'Exports : 9:16, 1:1, 16:9' }, type: LessonType.VIDEO, minutes: 14 },
        ],
      },
      {
        title: { fr: 'Droits et bonnes pratiques' },
        lessons: [
          { title: { fr: 'Filmer des personnes : autorisation et respect' }, type: LessonType.VIDEO, minutes: 16 },
          { title: { fr: 'Musique : où trouver des titres réellement libres' }, type: LessonType.VIDEO, minutes: 14 },
          { title: { fr: 'Mentions obligatoires d’une vidéo commerciale' }, type: LessonType.VIDEO, minutes: 12 },
          { title: { fr: 'Quiz : droits et mentions' }, type: LessonType.QUIZ, minutes: 10 },
        ],
      },
      {
        title: { fr: 'Publier et durer' },
        lessons: [
          { title: { fr: 'Miniatures et premières secondes' }, type: LessonType.VIDEO, minutes: 15 },
          { title: { fr: 'Tenir un rythme de publication soutenable' }, type: LessonType.VIDEO, minutes: 17 },
          { title: { fr: 'Lire ses statistiques et refaire ce qui marche' }, type: LessonType.VIDEO, minutes: 16 },
          { title: { fr: 'Projet final : trois formats courts publiés' }, type: LessonType.ASSIGNMENT, minutes: 45 },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 7 · Français professionnel — programme fr
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'francais-professionnel-ecrire-au-travail',
    categorySlug: 'langues',
    instructorEmail: 'gestion@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.INTERMEDIAIRE,
    deliveryMode: DeliveryMode.HYBRIDE,
    contentLocale: Locale.fr,
    priceCentimes: 90_000,
    comparePriceCentimes: 120_000,
    accessDurationDays: 180,
    publishedDaysAgo: 96,
    completeLocales: [Locale.fr],
    text: {
      fr: {
        title: 'Français professionnel : écrire au travail',
        subtitle: 'Des e-mails, des comptes rendus et des offres qu’on lit jusqu’au bout',
        description:
          "Ce n'est pas un cours de grammaire. C'est un entraînement à l'écrit du travail : demander sans froisser, refuser sans fermer la porte, relancer sans harceler, résumer une réunion en dix lignes utiles.\n\nChaque séance part de vos propres écrits, anonymisés, et se termine par une réécriture. Les points de langue sont traités quand ils apparaissent, pas dans l'ordre d'un manuel.",
        objectives: [
          'Écrire un e-mail professionnel clair, poli et court',
          'Rédiger un compte rendu de réunion exploitable',
          'Structurer une offre commerciale ou une candidature',
          'Corriger les fautes qui coûtent le plus en crédibilité',
          'Adapter le ton au destinataire sans se perdre en formules',
        ],
        audience: [
          'Salariés qui écrivent quotidiennement en français',
          'Candidats préparant un dossier ou un entretien',
          'Indépendants qui rédigent leurs devis et leurs relances',
        ],
        requirements: [
          'Un niveau B1 environ : comprendre et écrire des phrases complètes',
          'Apporter deux écrits professionnels récents',
        ],
        seoTitle: 'Formation français professionnel à Meknès — écrits du travail',
        seoDescription:
          'Formation français professionnel : e-mails, comptes rendus, offres et relances. Travail sur vos propres écrits, en centre et à distance.',
      },
      ar: {
        title: 'الفرنسية المهنية: الكتابة في العمل',
        subtitle: 'رسائل وتقارير وعروض تُقرأ إلى آخرها',
        description:
          'ليست دورة في القواعد، بل تدريب على كتابة العمل: أن تطلبوا دون إحراج، وترفضوا دون إغلاق الباب، وتذكّروا دون إلحاح، وتلخّصوا اجتماعاً في عشرة أسطر مفيدة.\n\nتنطلق كل حصة من كتاباتكم أنتم، بعد حذف الأسماء، وتنتهي بإعادة صياغة. تُعالَج النقاط اللغوية حين تظهر، لا بترتيب كتاب مدرسي.',
        objectives: [
          'كتابة رسالة مهنية واضحة ومهذّبة وقصيرة',
          'تحرير محضر اجتماع قابل للاستثمار',
          'هيكلة عرض تجاري أو ملف ترشيح',
          'تصحيح الأخطاء الأكثر كلفة على المصداقية',
          'ملاءمة النبرة مع المرسَل إليه دون الغرق في الصيغ',
        ],
        audience: [
          'الأجراء الذين يكتبون يومياً بالفرنسية',
          'المترشحون الذين يعدّون ملفاً أو مقابلة',
          'المستقلّون الذين يحرّرون عروضهم وتذكيراتهم',
        ],
        requirements: ['مستوى B1 تقريباً: فهم وكتابة جمل كاملة', 'إحضار كتابتين مهنيتين حديثتين'],
        seoTitle: 'تكوين في الفرنسية المهنية بمكناس — كتابات العمل',
        seoDescription:
          'دورة تدريبية في الفرنسية المهنية: الرسائل والمحاضر والعروض والتذكيرات. اشتغال على كتاباتكم، حضورياً وعن بعد.',
      },
      en: {
        title: 'Professional French: writing at work',
        subtitle: 'Emails, minutes and proposals people read to the end',
        description:
          'This is not a grammar class. It is training in workplace writing: asking without offending, declining without closing the door, following up without harassing, summarising a meeting in ten useful lines.\n\nEvery session starts from your own writing, anonymised, and ends with a rewrite. Language points are covered when they come up, not in textbook order.',
        objectives: [
          'Write a clear, polite, short professional email',
          'Produce usable meeting minutes',
          'Structure a commercial proposal or an application',
          'Fix the mistakes that cost the most credibility',
          'Adapt tone to the recipient without drowning in formulas',
        ],
        audience: [
          'Employees who write in French every day',
          'Applicants preparing a file or an interview',
          'Freelancers writing their own quotes and follow-ups',
        ],
        requirements: [
          'Roughly a B1 level: understanding and writing full sentences',
          'Bring two recent pieces of professional writing',
        ],
        seoTitle: 'Professional French training in Meknès — workplace writing',
        seoDescription:
          'Professional French training: emails, minutes, proposals and follow-ups. Work on your own writing, on site and online.',
      },
      es: {
        title: 'Francés profesional: escribir en el trabajo',
        subtitle: 'Correos, actas y ofertas que se leen hasta el final',
        description:
          'No es un curso de gramática. Es un entrenamiento en la escritura del trabajo: pedir sin molestar, rechazar sin cerrar la puerta, insistir sin acosar, resumir una reunión en diez líneas útiles.\n\nCada sesión parte de sus propios escritos, anonimizados, y termina con una reescritura. Los puntos de lengua se tratan cuando aparecen, no en el orden de un manual.',
        objectives: [
          'Escribir un correo profesional claro, cortés y breve',
          'Redactar un acta de reunión aprovechable',
          'Estructurar una oferta comercial o una candidatura',
          'Corregir los errores que más cuestan en credibilidad',
          'Adaptar el tono al destinatario sin perderse en fórmulas',
        ],
        audience: [
          'Empleados que escriben a diario en francés',
          'Candidatos que preparan un expediente o una entrevista',
          'Autónomos que redactan sus presupuestos y recordatorios',
        ],
        requirements: [
          'Un nivel B1 aproximado: comprender y escribir frases completas',
          'Traer dos escritos profesionales recientes',
        ],
        seoTitle: 'Formación en francés profesional en Meknès — escritos de trabajo',
        seoDescription:
          'Formación en francés profesional: correos, actas, ofertas y recordatorios. Trabajo sobre sus propios escritos, presencial y en línea.',
      },
    },
    modules: [
      {
        title: { fr: 'L’e-mail professionnel' },
        lessons: [
          { title: { fr: 'Ce qui fait qu’un e-mail reste sans réponse' }, type: LessonType.VIDEO, minutes: 12, isPreview: true },
          { title: { fr: 'Objet, première phrase, demande' }, type: LessonType.VIDEO, minutes: 18 },
          { title: { fr: 'Formules d’ouverture et de clôture, sans excès' }, type: LessonType.VIDEO, minutes: 15 },
          { title: { fr: 'Relancer sans harceler' }, type: LessonType.VIDEO, minutes: 14 },
          { title: { fr: 'Atelier : réécrire trois de vos e-mails' }, type: LessonType.ASSIGNMENT, minutes: 40 },
        ],
      },
      {
        title: { fr: 'Écrire pour être compris' },
        lessons: [
          {
            title: { fr: 'Phrases courtes, verbes précis' },
            type: LessonType.ARTICLE,
            minutes: 13,
            isPreview: true,
            content: {
              fr: "## Trois corrections qui changent tout\n\n**1. Un verbe plutôt qu'un nom.** « Procéder à la vérification du dossier » devient « vérifier le dossier ». La phrase raccourcit d'un tiers et gagne en netteté.\n\n**2. Une idée par phrase.** Si vous relisez à voix haute et que vous manquez d'air, coupez au premier « et ».\n\n**3. La demande en premier, la justification ensuite.** Le lecteur pressé lit la première ligne et la dernière. Mettez ce que vous attendez de lui en tête, pas en conclusion.\n\n> Avant : « Suite à notre échange de la semaine dernière concernant le dossier Karam et compte tenu des délais annoncés par le fournisseur, il serait souhaitable que vous puissiez nous faire un retour. »\n>\n> Après : « Pouvez-vous nous confirmer votre accord avant vendredi ? Le fournisseur bloque les prix jusqu'au 12. »",
            },
          },
          { title: { fr: 'Ponctuation et connecteurs logiques' }, type: LessonType.VIDEO, minutes: 17 },
          { title: { fr: 'Les fautes qui coûtent cher' }, type: LessonType.VIDEO, minutes: 20 },
          { title: { fr: 'Quiz : accords, temps, connecteurs' }, type: LessonType.QUIZ, minutes: 12 },
        ],
      },
      {
        title: { fr: 'Documents professionnels' },
        lessons: [
          { title: { fr: 'Le compte rendu de réunion' }, type: LessonType.VIDEO, minutes: 19 },
          { title: { fr: 'La note interne et la consigne' }, type: LessonType.VIDEO, minutes: 16 },
          { title: { fr: 'L’offre commerciale et le devis' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'CV et lettre de motivation' }, type: LessonType.VIDEO, minutes: 21 },
        ],
      },
      {
        title: { fr: 'Situations difficiles' },
        lessons: [
          { title: { fr: 'Refuser, reporter, corriger un client' }, type: LessonType.VIDEO, minutes: 18 },
          { title: { fr: 'Répondre à une réclamation' }, type: LessonType.VIDEO, minutes: 17 },
          { title: { fr: 'Annoncer un retard ou une erreur' }, type: LessonType.VIDEO, minutes: 16 },
          { title: { fr: 'Projet final : dossier écrit complet' }, type: LessonType.ASSIGNMENT, minutes: 45 },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 8 · Anglais professionnel — DRAFT, formateur en cours de recrutement
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'anglais-professionnel-prendre-la-parole',
    categorySlug: 'langues',
    instructorEmail: null,
    status: CourseStatus.DRAFT,
    level: CourseLevel.DEBUTANT,
    deliveryMode: DeliveryMode.PRESENTIEL,
    contentLocale: Locale.fr,
    priceCentimes: 110_000,
    maxSeats: 14,
    completeLocales: [Locale.fr],
    text: {
      fr: {
        title: 'Anglais professionnel : prendre la parole',
        subtitle: 'Se présenter, expliquer son travail, répondre en réunion',
        description:
          "L'oral d'abord : se présenter, décrire son poste, expliquer un problème, poser une question, répondre au téléphone. Les mises en situation occupent la majorité du temps ; la grammaire n'intervient que pour débloquer une phrase.\n\nCette formation ouvrira lorsque le recrutement du formateur sera terminé. Le programme et les dates seront publiés à ce moment-là.",
        objectives: [
          'Se présenter et présenter son entreprise en deux minutes',
          'Comprendre et relancer dans une conversation téléphonique',
          'Participer à une réunion courte sans se bloquer',
          'Écrire un e-mail simple et sans ambiguïté',
        ],
        audience: [
          'Salariés en contact avec des interlocuteurs étrangers',
          'Personnel de l’agroalimentaire, de l’export et du tourisme',
          'Débutants qui ont besoin de parler, pas de réviser',
        ],
        requirements: [
          'Notions scolaires d’anglais',
          'Assiduité : la progression à l’oral dépend de la régularité',
        ],
        seoTitle: 'Formation anglais professionnel à Meknès',
        seoDescription:
          'Formation d’anglais professionnel centrée sur l’oral : présentation, téléphone, réunions et e-mails simples. En présentiel à Meknès.',
      },
      ar: {
        title: 'الإنجليزية المهنية: أخذ الكلمة',
        subtitle: 'التقديم بالنفس، شرح العمل، الجواب في الاجتماع',
        description:
          'الشفوي أولاً: التعريف بالنفس، وصف المنصب، شرح مشكل، طرح سؤال، الردّ على الهاتف. تشغل الوضعيات التطبيقية أغلب الوقت؛ ولا تتدخل القواعد إلا لفكّ عقدة جملة.\n\nستنطلق هذه الدورة التدريبية بعد إتمام توظيف المكوِّن. وسيُنشر البرنامج والتواريخ حينها.',
        objectives: [
          'التعريف بالنفس وبالمقاولة في دقيقتين',
          'الفهم وإدارة مكالمة هاتفية',
          'المشاركة في اجتماع قصير دون توقف',
          'كتابة رسالة بسيطة وواضحة',
        ],
        audience: [
          'الأجراء الذين يتعاملون مع متحدثين أجانب',
          'مستخدمو المنطقة الحرة واللوجستيك',
          'المبتدئون الذين يحتاجون إلى الكلام لا إلى المراجعة',
        ],
        requirements: ['معارف مدرسية في الإنجليزية', 'المواظبة: التقدم الشفوي رهين بالانتظام'],
        seoTitle: 'تكوين في الإنجليزية المهنية بمكناس',
        seoDescription:
          'دورة في الإنجليزية المهنية تركّز على الشفوي: التقديم، الهاتف، الاجتماعات والرسائل البسيطة. حضورياً بمكناس.',
      },
      en: {
        title: 'Professional English: speaking up',
        subtitle: 'Introduce yourself, explain your work, answer in meetings',
        description:
          'Speaking first: introduce yourself, describe your job, explain a problem, ask a question, answer the phone. Role plays take up most of the time; grammar only steps in to unblock a sentence.\n\nThis course will open once the trainer recruitment is complete. The programme and dates will be published then.',
        objectives: [
          'Introduce yourself and your company in two minutes',
          'Understand and steer a phone conversation',
          'Take part in a short meeting without freezing',
          'Write a simple, unambiguous email',
        ],
        audience: [
          'Employees dealing with foreign counterparts',
          'Free-zone and logistics staff',
          'Beginners who need to speak, not to revise',
        ],
        requirements: ['School-level notions of English', 'Regular attendance: speaking progress depends on it'],
        seoTitle: 'Professional English training in Meknès',
        seoDescription:
          'Professional English training focused on speaking: introductions, phone calls, meetings and simple emails. On site in Meknès.',
      },
      es: {
        title: 'Inglés profesional: tomar la palabra',
        subtitle: 'Presentarse, explicar su trabajo, responder en una reunión',
        description:
          'Primero la expresión oral: presentarse, describir el puesto, explicar un problema, hacer una pregunta, responder al teléfono. Las simulaciones ocupan la mayor parte del tiempo; la gramática solo interviene para desbloquear una frase.\n\nEsta formación abrirá cuando termine la selección del formador. El programa y las fechas se publicarán entonces.',
        objectives: [
          'Presentarse y presentar su empresa en dos minutos',
          'Comprender y llevar una conversación telefónica',
          'Participar en una reunión breve sin bloquearse',
          'Escribir un correo sencillo y sin ambigüedad',
        ],
        audience: [
          'Empleados en contacto con interlocutores extranjeros',
          'Personal de la zona franca y de la logística',
          'Principiantes que necesitan hablar, no repasar',
        ],
        requirements: ['Nociones escolares de inglés', 'Asiduidad: el progreso oral depende de la regularidad'],
        seoTitle: 'Formación en inglés profesional en Meknès',
        seoDescription:
          'Formación de inglés profesional centrada en el habla: presentaciones, teléfono, reuniones y correos sencillos. Presencial en Meknès.',
      },
    },
    modules: [
      {
        title: { fr: 'Se présenter' },
        lessons: [
          { title: { fr: 'Introducing yourself and your company' }, type: LessonType.VIDEO, minutes: 16 },
          { title: { fr: 'Describing your job and your day' }, type: LessonType.VIDEO, minutes: 18 },
          { title: { fr: 'Small talk : les trois minutes avant la réunion' }, type: LessonType.VIDEO, minutes: 14 },
          { title: { fr: 'Mise en situation : deux minutes chrono' }, type: LessonType.ASSIGNMENT, minutes: 30 },
        ],
      },
      {
        title: { fr: 'Au téléphone' },
        lessons: [
          { title: { fr: 'Taking and leaving a message' }, type: LessonType.VIDEO, minutes: 17 },
          { title: { fr: 'Faire répéter sans gêne' }, type: LessonType.VIDEO, minutes: 14 },
          { title: { fr: 'Chiffres, dates et adresses à l’oral' }, type: LessonType.VIDEO, minutes: 15 },
          { title: { fr: 'Confirmer un rendez-vous et une commande' }, type: LessonType.VIDEO, minutes: 16 },
        ],
      },
      {
        title: { fr: 'Écrire simplement' },
        lessons: [
          { title: { fr: 'Un e-mail court et sans ambiguïté' }, type: LessonType.VIDEO, minutes: 18 },
          { title: { fr: 'Demander, confirmer, relancer' }, type: LessonType.VIDEO, minutes: 16 },
          { title: { fr: 'Les formules qui passent partout' }, type: LessonType.VIDEO, minutes: 13 },
          { title: { fr: 'Quiz : e-mails professionnels' }, type: LessonType.QUIZ, minutes: 10 },
        ],
      },
      {
        title: { fr: 'En réunion' },
        lessons: [
          { title: { fr: 'Agreeing, disagreeing, asking for time' }, type: LessonType.VIDEO, minutes: 19 },
          { title: { fr: 'Expliquer un problème et proposer une solution' }, type: LessonType.VIDEO, minutes: 20 },
          { title: { fr: 'Quiz : expressions de réunion' }, type: LessonType.QUIZ, minutes: 10 },
          { title: { fr: 'Mise en situation finale' }, type: LessonType.ASSIGNMENT, minutes: 40 },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 9 · Créer son entreprise au Maroc — programme fr
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'creer-son-entreprise-au-maroc',
    categorySlug: 'gestion-entrepreneuriat',
    instructorEmail: 'admin@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.TOUS_NIVEAUX,
    deliveryMode: DeliveryMode.HYBRIDE,
    contentLocale: Locale.fr,
    priceCentimes: 150_000,
    isFeatured: true,
    publishedDaysAgo: 129,
    completeLocales: [Locale.fr],
    text: {
      fr: {
        title: 'Créer son entreprise au Maroc',
        subtitle: 'Du projet écrit à l’immatriculation, sans mauvaise surprise',
        description:
          "Une formation qui va jusqu'au bout des démarches : valider son idée avec des chiffres, choisir entre auto-entrepreneur, SARL et SARL AU, monter le dossier, comprendre la CNSS, la TVA et l'impôt, et savoir ce que coûte réellement la première année.\n\nLes intervenants extérieurs — un comptable et un banquier — répondent aux questions concrètes lors de deux séances dédiées. Chaque participant repart avec son business plan chiffré et sa liste de démarches datée.",
        objectives: [
          'Chiffrer un projet et vérifier qu’il tient debout',
          'Choisir la forme juridique adaptée à sa situation',
          'Constituer un dossier de création complet',
          'Comprendre ses obligations fiscales et sociales dès le départ',
          'Préparer un dossier bancaire ou une demande de financement',
        ],
        audience: [
          'Porteurs de projet qui hésitent encore sur la forme juridique',
          'Auto-entrepreneurs qui veulent passer en société',
          'Salariés préparant une reconversion',
        ],
        requirements: [
          'Une idée de projet, même imparfaite',
          'Aucune connaissance juridique ou comptable préalable',
        ],
        seoTitle: 'Formation création d’entreprise au Maroc — Meknès',
        seoDescription:
          'Créer son entreprise au Maroc : business plan, statut juridique, immatriculation, CNSS, TVA et financement. Formation à Meknès, en centre et à distance.',
      },
      ar: {
        title: 'إحداث المقاولة بالمغرب',
        subtitle: 'من المشروع المكتوب إلى التسجيل، دون مفاجآت',
        description:
          'دورة تدريبية تذهب بالمساطر إلى نهايتها: التحقق من الفكرة بالأرقام، الاختيار بين المقاول الذاتي وشركة ذات مسؤولية محدودة بشريك واحد أو بعدة شركاء، إعداد الملف، فهم الصندوق الوطني للضمان الاجتماعي والضريبة على القيمة المضافة والضريبة على الشركات، ومعرفة الكلفة الحقيقية للسنة الأولى.\n\nيجيب متدخلان خارجيان — محاسب وإطار بنكي — عن الأسئلة العملية في حصتين مخصصتين. يغادر كل مشارك بخطة عمل مرقّمة ولائحة مساطر مؤرَّخة.',
        objectives: [
          'ترقيم المشروع والتأكد من قابليته للحياة',
          'اختيار الشكل القانوني الملائم للوضعية',
          'إعداد ملف إحداث كامل',
          'فهم الالتزامات الجبائية والاجتماعية منذ البداية',
          'تحضير ملف بنكي أو طلب تمويل',
        ],
        audience: [
          'حاملو المشاريع المترددون في الشكل القانوني',
          'المقاولون الذاتيون الراغبون في الانتقال إلى شركة',
          'الأجراء الذين يعدّون إعادة توجيه مهني',
        ],
        requirements: ['فكرة مشروع، ولو غير مكتملة', 'لا حاجة إلى معرفة قانونية أو محاسباتية سابقة'],
        seoTitle: 'تكوين في إحداث المقاولة بالمغرب — مكناس',
        seoDescription:
          'إحداث مقاولة بالمغرب: خطة العمل، الشكل القانوني، التسجيل، الضمان الاجتماعي، الضريبة على القيمة المضافة والتمويل. تكوين بمكناس حضورياً وعن بعد.',
      },
      en: {
        title: 'Starting a business in Morocco',
        subtitle: 'From written project to registration, with no bad surprises',
        description:
          'A course that goes all the way through the formalities: validate the idea with numbers, choose between sole trader, SARL and SARL AU, assemble the file, understand social security, VAT and tax, and know what the first year really costs.\n\nOutside speakers — an accountant and a banker — answer concrete questions in two dedicated sessions. Every participant leaves with a costed business plan and a dated list of formalities.',
        objectives: [
          'Cost a project and check that it stands up',
          'Choose the legal form that fits your situation',
          'Assemble a complete company formation file',
          'Understand your tax and social obligations from day one',
          'Prepare a bank file or a funding application',
        ],
        audience: [
          'Founders still hesitating over the legal form',
          'Sole traders moving to a company',
          'Employees preparing a career change',
        ],
        requirements: ['A project idea, however rough', 'No prior legal or accounting knowledge'],
        seoTitle: 'Business creation training in Morocco — Meknès',
        seoDescription:
          'Start a business in Morocco: business plan, legal form, registration, social security, VAT and funding. Training in Meknès, on site and online.',
      },
      es: {
        title: 'Crear su empresa en Marruecos',
        subtitle: 'Del proyecto escrito al registro, sin malas sorpresas',
        description:
          'Una formación que llega hasta el final de los trámites: validar la idea con cifras, elegir entre autónomo, SARL y SARL AU, preparar el expediente, entender la seguridad social, el IVA y el impuesto, y saber lo que cuesta de verdad el primer año.\n\nDos ponentes externos — un contable y un banquero — responden a las preguntas concretas en dos sesiones dedicadas. Cada participante se lleva su plan de negocio con cifras y su lista de trámites con fechas.',
        objectives: [
          'Poner cifras a un proyecto y comprobar que se sostiene',
          'Elegir la forma jurídica adecuada a su situación',
          'Reunir un expediente de constitución completo',
          'Comprender sus obligaciones fiscales y sociales desde el principio',
          'Preparar un expediente bancario o una solicitud de financiación',
        ],
        audience: [
          'Emprendedores que aún dudan sobre la forma jurídica',
          'Autónomos que quieren pasar a sociedad',
          'Empleados que preparan una reconversión',
        ],
        requirements: ['Una idea de proyecto, aunque sea imperfecta', 'Ningún conocimiento jurídico o contable previo'],
        seoTitle: 'Formación para crear empresa en Marruecos — Meknès',
        seoDescription:
          'Crear una empresa en Marruecos: plan de negocio, forma jurídica, registro, seguridad social, IVA y financiación. Formación en Meknès.',
      },
    },
    modules: [
      {
        title: { fr: 'Valider le projet' },
        lessons: [
          { title: { fr: 'Ce que cette formation ne fera pas à votre place' }, type: LessonType.VIDEO, minutes: 10, isPreview: true },
          { title: { fr: 'Étudier son marché sans budget d’étude' }, type: LessonType.VIDEO, minutes: 24 },
          { title: { fr: 'Le prévisionnel sur douze mois' }, type: LessonType.VIDEO, minutes: 30 },
          { title: { fr: 'Le seuil de rentabilité, calculé sur votre cas' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'Atelier : votre prévisionnel chiffré' }, type: LessonType.ASSIGNMENT, minutes: 50 },
        ],
      },
      {
        title: { fr: 'Choisir sa forme juridique' },
        lessons: [
          {
            title: { fr: 'Auto-entrepreneur, SARL AU, SARL : le tableau de décision' },
            type: LessonType.ARTICLE,
            minutes: 16,
            isPreview: true,
            content: {
              fr: "## Trois questions décident presque toujours\n\n**1. Quel chiffre d'affaires visez-vous la première année ?** Le statut d'auto-entrepreneur est plafonné ; au-delà, la question ne se pose plus.\n\n**2. Êtes-vous seul ?** Une SARL AU se crée à une personne ; une SARL suppose des associés, donc des statuts qui prévoient la sortie de chacun — écrivez-les avant la première dispute, pas après.\n\n**3. Qui sont vos clients ?** Beaucoup de donneurs d'ordre, notamment dans la filière agroalimentaire, ne travaillent qu'avec des sociétés et exigent une facture avec TVA.\n\nCe qu'il faut retenir : le statut n'est pas un engagement à vie. On commence souvent auto-entrepreneur pour tester le marché à faible coût, puis on bascule en société quand les clients ou le chiffre d'affaires l'imposent. Le mauvais choix n'est pas celui qu'on change ; c'est celui qu'on fait sans avoir posé ces trois questions.\n\n*Les seuils, taux et pièces demandées évoluent : les montants exacts sont vérifiés en séance avec le comptable intervenant.*",
            },
          },
          { title: { fr: 'Statuts, dénomination, siège social' }, type: LessonType.VIDEO, minutes: 21 },
          { title: { fr: 'Le parcours d’immatriculation, étape par étape' }, type: LessonType.VIDEO, minutes: 26 },
          { title: { fr: 'Séance avec le comptable : vos questions' }, type: LessonType.LIVE, minutes: 60, isMandatory: false },
        ],
      },
      {
        title: { fr: 'Obligations et premiers mois' },
        lessons: [
          { title: { fr: 'CNSS, salaires et déclarations' }, type: LessonType.VIDEO, minutes: 23 },
          { title: { fr: 'TVA : qui la facture, qui la récupère' }, type: LessonType.VIDEO, minutes: 25 },
          { title: { fr: 'Facturation conforme et délais de paiement' }, type: LessonType.VIDEO, minutes: 19 },
          { title: { fr: 'Quiz : formes juridiques et obligations' }, type: LessonType.QUIZ, minutes: 12 },
        ],
      },
      {
        title: { fr: 'Financer et démarrer' },
        lessons: [
          { title: { fr: 'Dispositifs d’appui et financements existants' }, type: LessonType.VIDEO, minutes: 24 },
          { title: { fr: 'Préparer son rendez-vous bancaire' }, type: LessonType.VIDEO, minutes: 20 },
          { title: { fr: 'Séance avec le banquier : lecture de dossiers' }, type: LessonType.LIVE, minutes: 60, isMandatory: false },
          { title: { fr: 'Projet final : business plan et plan de démarrage' }, type: LessonType.ASSIGNMENT, minutes: 60 },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 10 · Comptabilité et gestion d'une TPE — programme fr
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'comptabilite-et-gestion-d-une-tpe',
    categorySlug: 'gestion-entrepreneuriat',
    instructorEmail: 'admin@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.INTERMEDIAIRE,
    deliveryMode: DeliveryMode.PRESENTIEL,
    contentLocale: Locale.fr,
    priceCentimes: 280_000,
    comparePriceCentimes: 350_000,
    installmentCount: 2,
    maxSeats: 16,
    publishedDaysAgo: 62,
    completeLocales: [Locale.fr],
    text: {
      fr: {
        title: 'Comptabilité et gestion d’une TPE',
        subtitle: 'Tenir ses comptes, lire ses chiffres, parler à son comptable',
        description:
          "Une formation pour les gérants qui subissent leur comptabilité. Vous apprenez à tenir des pièces propres, à classer, à lire un bilan et un compte de résultat, à suivre votre trésorerie et à préparer les échéances fiscales sans panique.\n\nLes exercices se font sur un jeu de pièces réel et anonymisé — factures, relevés, bulletins — du premier classement jusqu'aux états de fin d'exercice.",
        objectives: [
          'Organiser ses pièces comptables et son classement',
          'Passer les écritures courantes et comprendre la partie double',
          'Lire un bilan et un compte de résultat sans traducteur',
          'Suivre sa trésorerie et anticiper les creux',
          'Préparer les échéances fiscales et sociales dans les délais',
        ],
        audience: [
          'Gérants de TPE et commerçants',
          'Assistants administratifs qui préparent la comptabilité',
          'Auto-entrepreneurs en croissance',
        ],
        requirements: [
          'Gérer ou accompagner une activité réelle',
          'Un niveau d’arithmétique courant suffit',
        ],
        seoTitle: 'Formation comptabilité TPE à Meknès',
        seoDescription:
          'Formation comptabilité et gestion pour TPE : pièces, écritures, bilan, compte de résultat, trésorerie et échéances fiscales. Présentiel à Meknès.',
      },
      ar: {
        title: 'المحاسبة وتدبير مقاولة صغيرة جداً',
        subtitle: 'مسك الحسابات، قراءة الأرقام، ومحاورة المحاسب',
        description:
          'دورة تدريبية موجَّهة للمسيّرين الذين يتحمّلون محاسبتهم دون فهمها. تتعلّمون مسك وثائق سليمة وترتيبها، وقراءة الميزانية وحساب النتيجة، وتتبع الخزينة، وتحضير الاستحقاقات الجبائية دون ارتباك.\n\nتُنجز التمارين على مجموعة وثائق حقيقية بعد حذف الأسماء — فواتير وكشوف وبطاقات أداء — من أول ترتيب إلى القوائم الختامية.',
        objectives: [
          'تنظيم الوثائق المحاسباتية وترتيبها',
          'تسجيل العمليات الجارية وفهم القيد المزدوج',
          'قراءة الميزانية وحساب النتيجة دون وسيط',
          'تتبع الخزينة وتوقّع فترات العسر',
          'تحضير الاستحقاقات الجبائية والاجتماعية في آجالها',
        ],
        audience: [
          'مسيّرو المقاولات الصغيرة جداً والتجار',
          'الأعوان الإداريون الذين يحضّرون المحاسبة',
          'المقاولون الذاتيون في مرحلة نمو',
        ],
        requirements: ['تسيير نشاط حقيقي أو مواكبته', 'مستوى حسابي عادي يكفي'],
        seoTitle: 'تكوين في محاسبة المقاولات الصغيرة بمكناس',
        seoDescription:
          'دورة في المحاسبة والتدبير للمقاولات الصغيرة جداً: الوثائق، التسجيلات، الميزانية، حساب النتيجة، الخزينة والاستحقاقات. حضورياً بمكناس.',
      },
      en: {
        title: 'Accounting and management for a very small business',
        subtitle: 'Keep your books, read your numbers, talk to your accountant',
        description:
          'A course for owners who endure their accounting. You learn to keep clean records, file them, read a balance sheet and a profit and loss account, follow your cash and prepare tax deadlines without panic.\n\nExercises run on a real, anonymised set of documents — invoices, statements, payslips — from first filing to year-end statements.',
        objectives: [
          'Organise your accounting documents and filing',
          'Post everyday entries and understand double entry',
          'Read a balance sheet and a P&L without a translator',
          'Track your cash and anticipate the dips',
          'Prepare tax and social deadlines on time',
        ],
        audience: [
          'Owners of very small businesses and shopkeepers',
          'Administrative assistants who prepare the accounts',
          'Growing sole traders',
        ],
        requirements: ['Running or supporting a real business', 'Everyday arithmetic is enough'],
        seoTitle: 'Small business accounting training in Meknès',
        seoDescription:
          'Accounting and management training for very small businesses: records, entries, balance sheet, P&L, cash flow and tax deadlines. On site in Meknès.',
      },
      es: {
        title: 'Contabilidad y gestión de una microempresa',
        subtitle: 'Llevar sus cuentas, leer sus cifras, hablar con su contable',
        description:
          'Una formación para gerentes que padecen su contabilidad. Aprende a mantener documentos limpios, a archivarlos, a leer un balance y una cuenta de resultados, a seguir su tesorería y a preparar los vencimientos fiscales sin pánico.\n\nLos ejercicios se hacen sobre un conjunto real y anonimizado de documentos — facturas, extractos, nóminas — desde el primer archivo hasta los estados de cierre.',
        objectives: [
          'Organizar sus documentos contables y su archivo',
          'Registrar los asientos corrientes y entender la partida doble',
          'Leer un balance y una cuenta de resultados sin traductor',
          'Seguir su tesorería y anticipar los baches',
          'Preparar los vencimientos fiscales y sociales en plazo',
        ],
        audience: [
          'Gerentes de microempresas y comerciantes',
          'Auxiliares administrativos que preparan la contabilidad',
          'Autónomos en crecimiento',
        ],
        requirements: ['Gestionar o acompañar una actividad real', 'Basta un nivel de aritmética corriente'],
        seoTitle: 'Formación en contabilidad para microempresas en Meknès',
        seoDescription:
          'Formación en contabilidad y gestión para microempresas: documentos, asientos, balance, resultados, tesorería y vencimientos. Presencial en Meknès.',
      },
    },
    modules: [
      {
        title: { fr: 'Mettre de l’ordre' },
        lessons: [
          { title: { fr: 'Pourquoi vos pièces coûtent cher à votre comptable' }, type: LessonType.VIDEO, minutes: 12, isPreview: true },
          { title: { fr: 'Pièces justificatives : ce qui est obligatoire' }, type: LessonType.VIDEO, minutes: 20 },
          {
            title: { fr: 'Classement mensuel qui tient toute l’année' },
            type: LessonType.ARTICLE,
            minutes: 14,
            isPreview: true,
            content: {
              fr: "## Le classement qui survit au mois de décembre\n\nLa règle est simple : **un dossier par mois, quatre intercalaires dedans**, et rien d'autre.\n\n1. **Achats** — factures fournisseurs, dans l'ordre où elles arrivent.\n2. **Ventes** — vos factures émises, numérotées sans trou. Une numérotation qui saute est le premier point relevé en contrôle.\n3. **Banque et caisse** — relevés, bordereaux de versement, tickets de caisse agrafés par jour.\n4. **Personnel et impôts** — bulletins, déclarations, quittances.\n\nDeux habitudes suffisent ensuite :\n\n- **Le vendredi, dix minutes.** On classe la semaine. Une pile de trois mois ne se rattrape jamais en une soirée.\n- **On annote la pièce au moment où on la classe** : mode de règlement et date. Six mois plus tard, personne ne se souvient si la facture de mars a été payée en espèces ou par virement — et c'est exactement ce que votre comptable vous demandera.\n\nUn classement tenu ainsi transforme la clôture d'exercice en une journée de travail au lieu d'une semaine, et il coûte moins cher en honoraires.",
            },
          },
          { title: { fr: 'Atelier : classer un mois de pièces réelles' }, type: LessonType.ASSIGNMENT, minutes: 45 },
        ],
      },
      {
        title: { fr: 'Les écritures courantes' },
        lessons: [
          { title: { fr: 'La partie double, expliquée une fois pour toutes' }, type: LessonType.VIDEO, minutes: 26 },
          { title: { fr: 'Achats, ventes, banque, caisse' }, type: LessonType.VIDEO, minutes: 28 },
          { title: { fr: 'Salaires et charges sociales' }, type: LessonType.VIDEO, minutes: 24 },
          { title: { fr: 'Rapprochement bancaire' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'Quiz : écritures courantes' }, type: LessonType.QUIZ, minutes: 15 },
        ],
      },
      {
        title: { fr: 'Lire ses états' },
        lessons: [
          { title: { fr: 'Le bilan : ce que vous avez, ce que vous devez' }, type: LessonType.VIDEO, minutes: 25 },
          { title: { fr: 'Le compte de résultat : d’où vient le bénéfice' }, type: LessonType.VIDEO, minutes: 24 },
          { title: { fr: 'Amortissements et provisions, sans jargon' }, type: LessonType.VIDEO, minutes: 21 },
          { title: { fr: 'Les ratios qui alertent avant la banque' }, type: LessonType.VIDEO, minutes: 19 },
        ],
      },
      {
        title: { fr: 'Trésorerie et échéances' },
        lessons: [
          { title: { fr: 'Le tableau de trésorerie à treize semaines' }, type: LessonType.VIDEO, minutes: 27 },
          { title: { fr: 'Relancer un impayé sans perdre le client' }, type: LessonType.VIDEO, minutes: 18 },
          { title: { fr: 'Calendrier fiscal et social de l’année' }, type: LessonType.VIDEO, minutes: 20 },
          { title: { fr: 'Projet final : clôture d’un exercice complet' }, type: LessonType.ASSIGNMENT, minutes: 70 },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 11 · Excel — fully translated, 4 locales, cours donné en arabe
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'excel-de-zero-a-l-analyse',
    categorySlug: 'bureautique-ia',
    instructorEmail: 'gestion@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.DEBUTANT,
    deliveryMode: DeliveryMode.HYBRIDE,
    contentLocale: Locale.ar,
    priceCentimes: 80_000,
    comparePriceCentimes: 110_000,
    isFeatured: true,
    publishedDaysAgo: 105,
    completeLocales: [Locale.fr, Locale.ar, Locale.en, Locale.es],
    text: {
      fr: {
        title: 'Excel : de zéro à l’analyse',
        subtitle: 'Arrêter de recopier à la main ce qu’un tableur calcule tout seul',
        description:
          "Formation donnée en arabe, supports en français et en arabe. On part du premier tableau et on va jusqu'aux tableaux croisés dynamiques : saisie propre, formules qui ne cassent pas, mise en forme lisible, tri, filtres, graphiques et synthèses.\n\nChaque séance travaille sur des fichiers réels — stock, caisse, paie, suivi de commandes — que les participants apportent ou reprennent parmi les cas fournis.",
        objectives: [
          'Construire un tableau propre qui ne se casse pas au premier tri',
          'Écrire des formules fiables et comprendre les erreurs affichées',
          'Utiliser RECHERCHEX, SI et les fonctions de dates au quotidien',
          'Construire un tableau croisé dynamique et le mettre à jour',
          'Présenter des chiffres lisibles à quelqu’un qui ne les connaît pas',
        ],
        audience: [
          'Employés administratifs et commerciaux',
          'Gérants qui suivent leur activité dans un tableur',
          'Toute personne qui recopie encore des chiffres à la main',
        ],
        requirements: [
          'Savoir utiliser un ordinateur : fichiers, dossiers, clavier',
          'Excel installé, ou un compte gratuit en ligne',
        ],
        seoTitle: 'Formation Excel à Meknès — de zéro à l’analyse',
        seoDescription:
          'Formation Excel donnée en arabe à Meknès : tableaux, formules, RECHERCHEX, graphiques et tableaux croisés dynamiques. Supports en français et en arabe.',
      },
      ar: {
        title: 'إكسل: من الصفر إلى التحليل',
        subtitle: 'الكفّ عن النقل اليدوي لما يحسبه الجدول وحده',
        description:
          'دورة تدريبية تُقدَّم بالعربية، بحوامل بالفرنسية والعربية. ننطلق من أول جدول ونصل إلى الجداول المحورية: إدخال سليم، صيغ لا تنكسر، تنسيق واضح، ترتيب وتصفية ورسوم بيانية وخلاصات.\n\nتشتغل كل حصة على ملفات حقيقية — المخزون، الصندوق، الأجور، تتبع الطلبيات — يحضرها المشاركون أو يختارونها من الحالات المتوفرة.',
        objectives: [
          'بناء جدول سليم لا ينكسر عند أول ترتيب',
          'كتابة صيغ موثوقة وفهم رسائل الخطأ',
          'استعمال RECHERCHEX وSI ودوال التواريخ يومياً',
          'إنشاء جدول محوري وتحديثه',
          'تقديم أرقام واضحة لمن لا يعرفها',
        ],
        audience: [
          'الموظفون الإداريون والتجاريون',
          'المسيّرون الذين يتابعون نشاطهم في جدول',
          'كل من لا يزال ينقل الأرقام يدوياً',
        ],
        requirements: ['إتقان استعمال الحاسوب: الملفات والمجلدات ولوحة المفاتيح', 'إكسل مثبَّت، أو حساب مجاني على الإنترنت'],
        seoTitle: 'تكوين في إكسل بمكناس — من الصفر إلى التحليل',
        seoDescription:
          'دورة تدريبية في إكسل بالعربية بمكناس: الجداول، الصيغ، RECHERCHEX، الرسوم البيانية والجداول المحورية. حوامل بالفرنسية والعربية.',
      },
      en: {
        title: 'Excel: from zero to analysis',
        subtitle: 'Stop retyping by hand what a spreadsheet computes on its own',
        description:
          'Taught in Arabic, with materials in French and Arabic. We start from the first table and go all the way to pivot tables: clean data entry, formulas that do not break, readable formatting, sorting, filters, charts and summaries.\n\nEvery session works on real files — stock, till, payroll, order tracking — brought by participants or taken from the provided cases.',
        objectives: [
          'Build a clean table that does not break on the first sort',
          'Write reliable formulas and understand the errors displayed',
          'Use XLOOKUP, IF and date functions every day',
          'Build a pivot table and refresh it',
          'Present readable figures to someone who has never seen them',
        ],
        audience: [
          'Administrative and sales staff',
          'Owners who track their business in a spreadsheet',
          'Anyone still retyping numbers by hand',
        ],
        requirements: ['Comfortable with a computer: files, folders, keyboard', 'Excel installed, or a free online account'],
        seoTitle: 'Excel training in Meknès — from zero to analysis',
        seoDescription:
          'Excel training taught in Arabic in Meknès: tables, formulas, XLOOKUP, charts and pivot tables. Materials in French and Arabic.',
      },
      es: {
        title: 'Excel: de cero al análisis',
        subtitle: 'Dejar de copiar a mano lo que una hoja de cálculo calcula sola',
        description:
          'Formación impartida en árabe, con materiales en francés y árabe. Partimos de la primera tabla y llegamos hasta las tablas dinámicas: entrada de datos limpia, fórmulas que no se rompen, formato legible, orden, filtros, gráficos y resúmenes.\n\nCada sesión trabaja con archivos reales — stock, caja, nóminas, seguimiento de pedidos — que traen los participantes o que se toman de los casos facilitados.',
        objectives: [
          'Construir una tabla limpia que no se rompa al primer orden',
          'Escribir fórmulas fiables y entender los errores mostrados',
          'Usar BUSCARX, SI y las funciones de fecha a diario',
          'Construir una tabla dinámica y actualizarla',
          'Presentar cifras legibles a alguien que no las conoce',
        ],
        audience: [
          'Personal administrativo y comercial',
          'Gerentes que siguen su actividad en una hoja de cálculo',
          'Cualquiera que siga copiando cifras a mano',
        ],
        requirements: ['Saber usar un ordenador: archivos, carpetas, teclado', 'Excel instalado o una cuenta gratuita en línea'],
        seoTitle: 'Formación de Excel en Meknès — de cero al análisis',
        seoDescription:
          'Formación de Excel impartida en árabe en Meknès: tablas, fórmulas, BUSCARX, gráficos y tablas dinámicas. Materiales en francés y árabe.',
      },
    },
    modules: [
      {
        title: {
          fr: 'Le tableau propre',
          ar: 'الجدول السليم',
          en: 'The clean table',
          es: 'La tabla limpia',
        },
        lessons: [
          {
            title: {
              fr: 'Ce que vous ferez en quatre semaines',
              ar: 'ما ستنجزونه في أربعة أسابيع',
              en: 'What you will do in four weeks',
              es: 'Lo que hará en cuatro semanas',
            },
            type: LessonType.VIDEO,
            minutes: 7,
            isPreview: true,
          },
          {
            title: {
              fr: 'Lignes, colonnes, cellules : le vocabulaire utile',
              ar: 'الأسطر والأعمدة والخلايا: المفردات المفيدة',
              en: 'Rows, columns, cells: the useful vocabulary',
              es: 'Filas, columnas, celdas: el vocabulario útil',
            },
            type: LessonType.VIDEO,
            minutes: 15,
          },
          {
            title: {
              fr: 'Saisir des données qui resteront exploitables',
              ar: 'إدخال معطيات تبقى قابلة للاستثمار',
              en: 'Entering data that stays usable',
              es: 'Introducir datos que sigan siendo aprovechables',
            },
            type: LessonType.ARTICLE,
            minutes: 12,
            isPreview: true,
            content: {
              fr: "## Cinq règles qui évitent 90 % des problèmes\n\n1. **Une information par colonne.** « Ahmed Alami — Meknès » dans une seule cellule ne se triera jamais par ville.\n2. **Une seule ligne d'en-tête**, en haut, sans cellule fusionnée. Les cellules fusionnées cassent le tri, les filtres et les tableaux croisés.\n3. **Pas de ligne vide au milieu.** Excel croit que le tableau s'arrête là.\n4. **Les dates comme dates, les nombres comme nombres.** Si `12/03/2026` est aligné à gauche, c'est du texte : aucun calcul ne fonctionnera dessus.\n5. **Jamais d'unité dans la cellule.** Écrivez `1200`, pas `1200 DH` — l'unité va dans le titre de la colonne ou dans le format d'affichage.\n\nUn tableau qui respecte ces cinq règles se trie, se filtre, s'analyse et se recopie. Un tableau qui les ignore devra être ressaisi le jour où quelqu'un en aura vraiment besoin.",
              ar: '## خمس قواعد تتجنّب 90 % من المشاكل\n\n1. **معلومة واحدة في كل عمود.** «أحمد العلمي — مكناس» في خلية واحدة لن يُرتَّب أبداً حسب المدينة.\n2. **سطر ترويسة واحد**، في الأعلى، بدون خلايا مدمجة. الخلايا المدمجة تكسر الترتيب والتصفية والجداول المحورية.\n3. **لا سطر فارغ في الوسط.** إكسل يعتبر أن الجدول ينتهي هناك.\n4. **التواريخ كتواريخ، والأرقام كأرقام.** إذا كان `12/03/2026` محاذياً إلى اليسار فهو نصّ: ولن يشتغل عليه أي حساب.\n5. **لا وحدة داخل الخلية.** اكتبوا `1200` لا `1200 درهم` — الوحدة توضع في عنوان العمود أو في صيغة العرض.\n\nجدول يحترم هذه القواعد الخمس يُرتَّب ويُصفَّى ويُحلَّل ويُنسَخ. وجدول يتجاهلها سيُعاد إدخاله يوم يحتاجه أحد فعلاً.',
              en: '## Five rules that avoid 90 % of problems\n\n1. **One piece of information per column.** "Ahmed Alami — Meknès" in a single cell will never sort by city.\n2. **A single header row**, at the top, with no merged cells. Merged cells break sorting, filters and pivot tables.\n3. **No empty row in the middle.** Excel thinks the table stops there.\n4. **Dates as dates, numbers as numbers.** If `12/03/2026` is left-aligned, it is text: no calculation will work on it.\n5. **Never a unit inside the cell.** Write `1200`, not `1200 DH` — the unit belongs in the column title or the display format.\n\nA table that follows these five rules sorts, filters, analyses and copies. A table that ignores them will have to be retyped the day someone actually needs it.',
              es: '## Cinco reglas que evitan el 90 % de los problemas\n\n1. **Una información por columna.** «Ahmed Alami — Meknès» en una sola celda nunca se ordenará por ciudad.\n2. **Una única fila de encabezado**, arriba, sin celdas combinadas. Las celdas combinadas rompen el orden, los filtros y las tablas dinámicas.\n3. **Ninguna fila vacía en medio.** Excel cree que la tabla termina ahí.\n4. **Las fechas como fechas, los números como números.** Si `12/03/2026` está alineado a la izquierda, es texto: ningún cálculo funcionará.\n5. **Nunca una unidad dentro de la celda.** Escriba `1200`, no `1200 DH` — la unidad va en el título de la columna o en el formato.\n\nUna tabla que respeta estas cinco reglas se ordena, se filtra, se analiza y se copia. Una que las ignora habrá que reescribirla el día en que alguien la necesite de verdad.',
            },
          },
          {
            title: {
              fr: 'Mise en forme lisible et impression',
              ar: 'تنسيق واضح والطباعة',
              en: 'Readable formatting and printing',
              es: 'Formato legible e impresión',
            },
            type: LessonType.VIDEO,
            minutes: 18,
          },
          {
            title: {
              fr: 'Atelier : reprendre un fichier existant',
              ar: 'ورشة: إصلاح ملف موجود',
              en: 'Workshop: fixing an existing file',
              es: 'Taller: arreglar un archivo existente',
            },
            type: LessonType.ASSIGNMENT,
            minutes: 35,
          },
        ],
      },
      {
        title: {
          fr: 'Les formules',
          ar: 'الصيغ',
          en: 'Formulas',
          es: 'Las fórmulas',
        },
        lessons: [
          {
            title: {
              fr: 'Références relatives et absolues',
              ar: 'المراجع النسبية والمطلقة',
              en: 'Relative and absolute references',
              es: 'Referencias relativas y absolutas',
            },
            type: LessonType.VIDEO,
            minutes: 20,
          },
          {
            title: {
              fr: 'SOMME, MOYENNE, NB, et leurs versions conditionnelles',
              ar: 'SOMME وMOYENNE وNB ونسخها الشرطية',
              en: 'SUM, AVERAGE, COUNT and their conditional versions',
              es: 'SUMA, PROMEDIO, CONTAR y sus versiones condicionales',
            },
            type: LessonType.VIDEO,
            minutes: 24,
          },
          {
            title: {
              fr: 'SI, ET, OU : décider dans une cellule',
              ar: 'SI وET وOU: اتخاذ القرار داخل الخلية',
              en: 'IF, AND, OR: deciding inside a cell',
              es: 'SI, Y, O: decidir dentro de una celda',
            },
            type: LessonType.VIDEO,
            minutes: 22,
          },
          {
            title: {
              fr: 'RECHERCHEX : relier deux tableaux',
              ar: 'RECHERCHEX: ربط جدولين',
              en: 'XLOOKUP: linking two tables',
              es: 'BUSCARX: enlazar dos tablas',
            },
            type: LessonType.VIDEO,
            minutes: 26,
          },
          {
            title: {
              fr: 'Dates, durées et calculs d’échéances',
              ar: 'التواريخ والمدد وحساب الآجال',
              en: 'Dates, durations and deadline calculations',
              es: 'Fechas, duraciones y cálculo de vencimientos',
            },
            type: LessonType.VIDEO,
            minutes: 21,
          },
          {
            title: {
              fr: 'Quiz : formules et références',
              ar: 'اختبار: الصيغ والمراجع',
              en: 'Quiz: formulas and references',
              es: 'Cuestionario: fórmulas y referencias',
            },
            type: LessonType.QUIZ,
            minutes: 12,
          },
        ],
      },
      {
        title: {
          fr: 'Trier, filtrer, synthétiser',
          ar: 'الترتيب والتصفية والتلخيص',
          en: 'Sort, filter, summarise',
          es: 'Ordenar, filtrar, resumir',
        },
        lessons: [
          {
            title: {
              fr: 'Tris et filtres avancés',
              ar: 'الترتيب والتصفية المتقدمة',
              en: 'Advanced sorting and filtering',
              es: 'Ordenación y filtros avanzados',
            },
            type: LessonType.VIDEO,
            minutes: 19,
          },
          {
            title: {
              fr: 'Mise en forme conditionnelle utile',
              ar: 'التنسيق الشرطي المفيد',
              en: 'Conditional formatting that helps',
              es: 'Formato condicional útil',
            },
            type: LessonType.VIDEO,
            minutes: 17,
          },
          {
            title: {
              fr: 'Tableaux croisés dynamiques : la première fois',
              ar: 'الجداول المحورية: المرة الأولى',
              en: 'Pivot tables: the first time',
              es: 'Tablas dinámicas: la primera vez',
            },
            type: LessonType.VIDEO,
            minutes: 28,
          },
          {
            title: {
              fr: 'Graphiques qui disent quelque chose',
              ar: 'رسوم بيانية تقول شيئاً',
              en: 'Charts that say something',
              es: 'Gráficos que dicen algo',
            },
            type: LessonType.VIDEO,
            minutes: 23,
          },
          {
            title: {
              fr: 'Atelier : tableau de bord mensuel',
              ar: 'ورشة: لوحة قيادة شهرية',
              en: 'Workshop: monthly dashboard',
              es: 'Taller: cuadro de mando mensual',
            },
            type: LessonType.ASSIGNMENT,
            minutes: 45,
          },
        ],
      },
      {
        title: {
          fr: 'Gagner du temps',
          ar: 'ربح الوقت',
          en: 'Saving time',
          es: 'Ganar tiempo',
        },
        lessons: [
          {
            title: {
              fr: 'Raccourcis clavier qui changent la journée',
              ar: 'اختصارات لوحة المفاتيح التي تغيّر اليوم',
              en: 'Keyboard shortcuts that change your day',
              es: 'Atajos de teclado que cambian el día',
            },
            type: LessonType.VIDEO,
            minutes: 14,
          },
          {
            title: {
              fr: 'Validation des données et listes déroulantes',
              ar: 'التحقق من المعطيات والقوائم المنسدلة',
              en: 'Data validation and dropdown lists',
              es: 'Validación de datos y listas desplegables',
            },
            type: LessonType.VIDEO,
            minutes: 20,
          },
          {
            title: {
              fr: 'Protéger un fichier partagé',
              ar: 'حماية ملف مشترك',
              en: 'Protecting a shared file',
              es: 'Proteger un archivo compartido',
            },
            type: LessonType.VIDEO,
            minutes: 16,
          },
          {
            title: {
              fr: 'Projet final : suivi complet de votre activité',
              ar: 'المشروع الختامي: تتبع كامل لنشاطكم',
              en: 'Final project: a complete tracker for your business',
              es: 'Proyecto final: seguimiento completo de su actividad',
            },
            type: LessonType.ASSIGNMENT,
            minutes: 50,
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 12 · IA générative au quotidien — programme fr + ar
  // ─────────────────────────────────────────────────────────────────────────
  {
    slug: 'ia-generative-au-quotidien',
    categorySlug: 'bureautique-ia',
    instructorEmail: 'nadia.ouazzani@cfi.ma',
    status: CourseStatus.PUBLISHED,
    level: CourseLevel.TOUS_NIVEAUX,
    deliveryMode: DeliveryMode.EN_LIGNE,
    contentLocale: Locale.fr,
    priceCentimes: 140_000,
    comparePriceCentimes: 190_000,
    maxSeats: 24,
    accessDurationDays: 365,
    isFeatured: true,
    isNew: true,
    publishedDaysAgo: 21,
    completeLocales: [Locale.fr],
    text: {
      fr: {
        title: 'IA générative au quotidien',
        subtitle: 'Gagner des heures sans raconter n’importe quoi à votre place',
        description:
          "Une formation d'usage professionnel, pas de démonstration. Vous apprenez à formuler une demande précise, à fournir le bon contexte, à vérifier une réponse, et à repérer immédiatement ce qu'un modèle a inventé.\n\nOn traite les cas réels du bureau : rédiger et résumer, traduire en gardant le sens, préparer un support, nettoyer un tableau, dépouiller un questionnaire. La question des données confidentielles est traitée sérieusement — ce qui ne doit jamais sortir de votre organisation ne sortira pas.",
        objectives: [
          'Écrire une consigne précise qui donne un résultat exploitable',
          'Fournir le contexte et le format attendu plutôt que de corriger après',
          'Vérifier une réponse et repérer une invention',
          'Traduire et adapter entre français, arabe et anglais sans perdre le sens',
          'Décider ce qui ne doit jamais être envoyé à un outil externe',
        ],
        audience: [
          'Employés de bureau, tous services confondus',
          'Enseignants et formateurs',
          'Indépendants qui produisent beaucoup d’écrits',
        ],
        requirements: [
          'Un ordinateur et une connexion correcte',
          'Aucune compétence technique particulière',
        ],
        seoTitle: 'Formation IA générative au quotidien — Meknès',
        seoDescription:
          'Formation à l’usage professionnel de l’IA générative : consignes précises, vérification des réponses, traduction, tableaux et confidentialité des données.',
      },
      ar: {
        title: 'الذكاء الاصطناعي التوليدي في العمل اليومي',
        subtitle: 'ربح ساعات دون أن يقول أحد كلاماً غير صحيح باسمكم',
        description:
          'دورة تدريبية للاستعمال المهني لا للعرض. تتعلّمون صياغة طلب دقيق، وتقديم السياق المناسب، والتحقق من الجواب، والانتباه فوراً إلى ما اختلقه النموذج.\n\nنعالج حالات المكتب الحقيقية: التحرير والتلخيص، الترجمة مع حفظ المعنى، إعداد عرض، تنظيف جدول، تفريغ استمارة. وتُعالَج مسألة المعطيات السرية بجدية — ما يجب ألّا يخرج من مؤسستكم لن يخرج.',
        objectives: [
          'كتابة تعليمة دقيقة تعطي نتيجة قابلة للاستعمال',
          'تقديم السياق والصيغة المنتظرة بدل التصحيح لاحقاً',
          'التحقق من الجواب واكتشاف ما اختُلق',
          'الترجمة والملاءمة بين الفرنسية والعربية والإنجليزية دون فقدان المعنى',
          'تحديد ما لا يجب إرساله أبداً إلى أداة خارجية',
        ],
        audience: ['موظفو المكاتب بمختلف المصالح', 'الأساتذة والمكوّنون', 'المستقلّون الذين ينتجون كتابات كثيرة'],
        requirements: ['حاسوب واتصال جيد', 'لا حاجة إلى أي كفاءة تقنية خاصة'],
        seoTitle: 'تكوين في الذكاء الاصطناعي التوليدي — مكناس',
        seoDescription:
          'دورة تدريبية في الاستعمال المهني للذكاء الاصطناعي التوليدي: التعليمات الدقيقة، التحقق من الأجوبة، الترجمة، الجداول وسرية المعطيات.',
      },
      en: {
        title: 'Generative AI in everyday work',
        subtitle: 'Save hours without letting it invent things in your name',
        description:
          'A course about professional use, not demonstration. You learn to phrase a precise request, provide the right context, check an answer, and spot immediately what a model made up.\n\nWe cover the real cases of an office: writing and summarising, translating without losing meaning, preparing a deck, cleaning a table, going through a questionnaire. Confidential data is treated seriously — what must never leave your organisation will not leave it.',
        objectives: [
          'Write a precise instruction that yields a usable result',
          'Provide context and the expected format instead of fixing afterwards',
          'Check an answer and spot an invention',
          'Translate and adapt between French, Arabic and English without losing meaning',
          'Decide what must never be sent to an external tool',
        ],
        audience: ['Office staff, across all departments', 'Teachers and trainers', 'Freelancers who produce a lot of writing'],
        requirements: ['A computer and a decent connection', 'No particular technical skill'],
        seoTitle: 'Generative AI at work training — Meknès',
        seoDescription:
          'Training on professional use of generative AI: precise instructions, checking answers, translation, tables and data confidentiality.',
      },
      es: {
        title: 'IA generativa en el trabajo diario',
        subtitle: 'Ganar horas sin que invente cosas en su nombre',
        description:
          'Una formación de uso profesional, no de demostración. Aprende a formular una petición precisa, a aportar el contexto adecuado, a verificar una respuesta y a detectar de inmediato lo que un modelo se ha inventado.\n\nTratamos los casos reales de una oficina: redactar y resumir, traducir sin perder el sentido, preparar un soporte, limpiar una tabla, vaciar un cuestionario. La cuestión de los datos confidenciales se trata en serio: lo que nunca debe salir de su organización no saldrá.',
        objectives: [
          'Escribir una instrucción precisa que dé un resultado aprovechable',
          'Aportar el contexto y el formato esperado en lugar de corregir después',
          'Verificar una respuesta y detectar una invención',
          'Traducir y adaptar entre francés, árabe e inglés sin perder el sentido',
          'Decidir qué no debe enviarse nunca a una herramienta externa',
        ],
        audience: ['Personal de oficina, de todos los servicios', 'Docentes y formadores', 'Autónomos que producen muchos textos'],
        requirements: ['Un ordenador y una conexión decente', 'Ninguna competencia técnica particular'],
        seoTitle: 'Formación en IA generativa en el trabajo — Meknès',
        seoDescription:
          'Formación sobre el uso profesional de la IA generativa: instrucciones precisas, verificación de respuestas, traducción, tablas y confidencialidad.',
      },
    },
    modules: [
      {
        title: { fr: 'Comprendre l’outil', ar: 'فهم الأداة' },
        lessons: [
          {
            title: { fr: 'Ce qu’un modèle sait, ce qu’il devine', ar: 'ما يعرفه النموذج وما يخمّنه' },
            type: LessonType.VIDEO,
            minutes: 13,
            isPreview: true,
          },
          {
            title: { fr: 'Une consigne précise vaut dix reformulations', ar: 'تعليمة دقيقة تغني عن عشر إعادات صياغة' },
            type: LessonType.ARTICLE,
            minutes: 14,
            isPreview: true,
            content: {
              fr: "## Quatre éléments, toujours les mêmes\n\nUne consigne qui fonctionne contient presque toujours :\n\n1. **Le rôle et le destinataire** — « Tu écris pour un client qui ne connaît pas le vocabulaire technique. »\n2. **La tâche exacte** — « Résume ce compte rendu en cinq points d'action, avec un responsable par point. »\n3. **Le contexte** — collez le document plutôt que de le décrire. Un modèle ne devine pas ce qu'il n'a pas lu.\n4. **Le format attendu** — « Une liste numérotée, dix lignes maximum, en français, vouvoiement. »\n\nComparez :\n\n> « Résume ce texte. »\n\n> « Résume ce compte rendu de réunion en cinq points d'action maximum. Pour chaque point : le responsable et la date d'échéance si elle est mentionnée. Ignore les échanges informels. Réponds en français, dans un tableau à trois colonnes. »\n\nLa deuxième demande produit un résultat utilisable du premier coup. La première produit quelque chose qu'il faudra reprendre — et le temps que vous croyiez gagner part dans la reprise.",
              ar: '## أربعة عناصر، دائماً هي نفسها\n\nالتعليمة الناجعة تتضمن في الغالب:\n\n1. **الدور والمرسَل إليه** — «أنت تكتب لزبون لا يعرف المصطلحات التقنية.»\n2. **المهمة بدقة** — «لخّص هذا المحضر في خمس نقاط عملية، مع مسؤول لكل نقطة.»\n3. **السياق** — الصقوا الوثيقة بدل وصفها. النموذج لا يخمّن ما لم يقرأه.\n4. **الصيغة المنتظرة** — «لائحة مرقّمة، عشرة أسطر كحد أقصى، بالفرنسية، بصيغة المخاطبة المهذّبة.»\n\nقارنوا:\n\n> «لخّص هذا النص.»\n\n> «لخّص محضر الاجتماع هذا في خمس نقاط عملية على الأكثر. لكل نقطة: المسؤول وتاريخ الاستحقاق إن ذُكر. تجاهل التبادلات غير الرسمية. أجب بالفرنسية في جدول من ثلاثة أعمدة.»\n\nالطلب الثاني ينتج نتيجة صالحة من أول مرة. والأول ينتج شيئاً سيلزم إصلاحه — والوقت الذي ظننتم أنكم ربحتموه يذهب في الإصلاح.',
            },
          },
          { title: { fr: 'Limites, biais et inventions', ar: 'الحدود والانحيازات والاختلاقات' }, type: LessonType.VIDEO, minutes: 18 },
          { title: { fr: 'Ce qu’on n’envoie jamais : données personnelles et secrets', ar: 'ما لا يُرسَل أبداً: المعطيات الشخصية والأسرار' }, type: LessonType.VIDEO, minutes: 20 },
        ],
      },
      {
        title: { fr: 'Écrire et résumer', ar: 'التحرير والتلخيص' },
        lessons: [
          { title: { fr: 'Rédiger un premier jet et le reprendre', ar: 'كتابة مسودة أولى ومراجعتها' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'Résumer un document long sans le trahir', ar: 'تلخيص وثيقة طويلة دون خيانتها' }, type: LessonType.VIDEO, minutes: 19 },
          { title: { fr: 'Traduire entre français, arabe et anglais', ar: 'الترجمة بين الفرنسية والعربية والإنجليزية' }, type: LessonType.VIDEO, minutes: 21 },
          { title: { fr: 'Garder votre voix, pas celle de la machine', ar: 'الحفاظ على صوتكم لا صوت الآلة' }, type: LessonType.VIDEO, minutes: 17 },
          { title: { fr: 'Atelier : trois tâches de votre semaine', ar: 'ورشة: ثلاث مهام من أسبوعكم' }, type: LessonType.ASSIGNMENT, minutes: 40 },
        ],
      },
      {
        title: { fr: 'Analyser et produire', ar: 'التحليل والإنتاج' },
        lessons: [
          { title: { fr: 'Nettoyer et reformater un tableau', ar: 'تنظيف جدول وإعادة تنسيقه' }, type: LessonType.VIDEO, minutes: 24 },
          { title: { fr: 'Dépouiller un questionnaire ouvert', ar: 'تفريغ استمارة مفتوحة' }, type: LessonType.VIDEO, minutes: 22 },
          { title: { fr: 'Préparer un support de présentation', ar: 'إعداد حامل عرض' }, type: LessonType.VIDEO, minutes: 20 },
          { title: { fr: 'Quiz : consignes, vérification, confidentialité', ar: 'اختبار: التعليمات والتحقق والسرية' }, type: LessonType.QUIZ, minutes: 12 },
        ],
      },
      {
        title: { fr: 'Installer l’usage dans l’équipe', ar: 'ترسيخ الاستعمال داخل الفريق' },
        lessons: [
          { title: { fr: 'Écrire une charte d’usage simple', ar: 'كتابة ميثاق استعمال بسيط' }, type: LessonType.VIDEO, minutes: 18 },
          { title: { fr: 'Constituer une bibliothèque de consignes', ar: 'بناء مكتبة من التعليمات' }, type: LessonType.VIDEO, minutes: 16 },
          { title: { fr: 'Former ses collègues en une heure', ar: 'تكوين زملائكم في ساعة واحدة' }, type: LessonType.VIDEO, minutes: 19 },
          { title: { fr: 'Projet final : automatiser une tâche de votre poste', ar: 'المشروع الختامي: أتمتة مهمة من منصبكم' }, type: LessonType.ASSIGNMENT, minutes: 45 },
        ],
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Parcours (§12.5) — bundles priced below the sum of their courses
// ═══════════════════════════════════════════════════════════════════════════

interface SeedPathText {
  readonly title: string;
  readonly description: string;
  readonly outcome: string;
}

interface SeedPath {
  readonly slug: string;
  /** Bundle price in centimes. Asserted below to be lower than the sum. */
  readonly priceCentimes: number;
  readonly isFeatured: boolean;
  /** In the order a learner should take them. */
  readonly courseSlugs: readonly string[];
  readonly text: Readonly<Record<Locale, SeedPathText>>;
}

const PATHS: readonly SeedPath[] = [
  {
    slug: 'parcours-marketing-digital-complet',
    priceCentimes: 390_000,
    isFeatured: true,
    courseSlugs: [
      'marketing-digital-fondations',
      'publicite-en-ligne-meta-et-google-ads',
      'ia-generative-au-quotidien',
    ],
    text: {
      fr: {
        title: 'Parcours marketing digital complet',
        description:
          "Les trois formations qui permettent de tenir seul la communication d'une entreprise : les fondations, la publicité payante, puis les outils qui font gagner du temps sur la production quotidienne. À suivre dans cet ordre, sur environ cinq mois.",
        outcome:
          "À la fin du parcours, vous pilotez un budget publicitaire, vous produisez vos contenus et vous rendez compte de vos résultats avec des chiffres que vous savez expliquer.",
      },
      ar: {
        title: 'مسار التسويق الرقمي الكامل',
        description:
          'الدورات الثلاث التي تمكّنكم من تدبير تواصل مقاولة بمفردكم: الأسس، ثم الإعلانات المؤدى عنها، ثم الأدوات التي تربح لكم الوقت في الإنتاج اليومي. تُتابَع بهذا الترتيب على مدى خمسة أشهر تقريباً.',
        outcome:
          'في نهاية المسار، تديرون ميزانية إعلانية، وتنتجون محتواكم، وتقدّمون نتائجكم بأرقام تعرفون شرحها.',
      },
      en: {
        title: 'Complete digital marketing path',
        description:
          "The three courses that let you run a company's communication on your own: the foundations, paid advertising, then the tools that save time on daily production. Take them in this order, over roughly five months.",
        outcome:
          'By the end you steer an advertising budget, produce your own content and report results with numbers you can explain.',
      },
      es: {
        title: 'Itinerario completo de marketing digital',
        description:
          'Las tres formaciones que permiten llevar solo la comunicación de una empresa: los fundamentos, la publicidad de pago y las herramientas que ahorran tiempo en la producción diaria. En este orden, durante unos cinco meses.',
        outcome:
          'Al terminar, dirige un presupuesto publicitario, produce sus contenidos y rinde cuentas con cifras que sabe explicar.',
      },
    },
  },
  {
    slug: 'parcours-developpeur-web',
    priceCentimes: 690_000,
    isFeatured: true,
    courseSlugs: [
      'developpement-web-html-css-javascript',
      'ui-ux-concevoir-des-interfaces-utilisables',
      'react-et-next-js-applications-web',
    ],
    text: {
      fr: {
        title: 'Parcours développeur web',
        description:
          "Du premier fichier HTML à une application déployée : les bases du web, la conception d'interfaces utilisables, puis le développement applicatif avec React et Next.js. Environ neuf mois, avec un projet livré à chaque étape.",
        outcome:
          "Vous sortez avec trois projets en ligne, un dépôt Git tenu proprement et le niveau attendu pour un premier poste de développeur front-end.",
      },
      ar: {
        title: 'مسار مطوّر الويب',
        description:
          'من أول ملف HTML إلى تطبيق منشور: أسس الويب، تصميم واجهات قابلة للاستعمال، ثم تطوير التطبيقات بـReact وNext.js. حوالي تسعة أشهر، بمشروع مُسلَّم في كل مرحلة.',
        outcome:
          'تخرجون بثلاثة مشاريع منشورة، ومستودع Git مُدار بإتقان، وبالمستوى المطلوب لأول منصب مطوّر واجهات.',
      },
      en: {
        title: 'Web developer path',
        description:
          'From the first HTML file to a deployed application: web fundamentals, usable interface design, then application development with React and Next.js. Around nine months, with a delivered project at each step.',
        outcome:
          'You leave with three projects online, a cleanly kept Git repository and the level expected for a first front-end developer position.',
      },
      es: {
        title: 'Itinerario de desarrollador web',
        description:
          'Del primer archivo HTML a una aplicación desplegada: fundamentos de la web, diseño de interfaces utilizables y desarrollo de aplicaciones con React y Next.js. Unos nueve meses, con un proyecto entregado en cada etapa.',
        outcome:
          'Sale con tres proyectos en línea, un repositorio Git bien llevado y el nivel esperado para un primer puesto de desarrollador front-end.',
      },
    },
  },
  {
    slug: 'parcours-creer-et-gerer-son-activite',
    priceCentimes: 420_000,
    isFeatured: false,
    courseSlugs: [
      'creer-son-entreprise-au-maroc',
      'comptabilite-et-gestion-d-une-tpe',
      'marketing-digital-fondations',
    ],
    text: {
      fr: {
        title: 'Parcours créer et gérer son activité',
        description:
          "Créer l'entreprise, tenir ses comptes, trouver ses clients : les trois compétences qui décident de la deuxième année. Pensé pour les porteurs de projet et les auto-entrepreneurs qui veulent passer à l'étape suivante.",
        outcome:
          'Vous repartez avec votre entreprise immatriculée ou prête à l’être, une comptabilité que vous tenez vous-même et un plan de communication écrit.',
      },
      ar: {
        title: 'مسار إحداث النشاط وتدبيره',
        description:
          'إحداث المقاولة، مسك الحسابات، إيجاد الزبناء: الكفاءات الثلاث التي تحسم السنة الثانية. مُعدّ لحاملي المشاريع والمقاولين الذاتيين الراغبين في الانتقال إلى المرحلة الموالية.',
        outcome:
          'تغادرون بمقاولة مسجَّلة أو جاهزة للتسجيل، ومحاسبة تمسكونها بأنفسكم، وخطة تواصل مكتوبة.',
      },
      en: {
        title: 'Start and run your business path',
        description:
          'Set up the company, keep the books, find customers: the three skills that decide the second year. Designed for founders and sole traders ready for the next step.',
        outcome:
          'You leave with your company registered or ready to be, accounts you keep yourself and a written communication plan.',
      },
      es: {
        title: 'Itinerario crear y gestionar su actividad',
        description:
          'Crear la empresa, llevar las cuentas, encontrar clientes: las tres competencias que deciden el segundo año. Pensado para emprendedores y autónomos listos para el siguiente paso.',
        outcome:
          'Sale con su empresa registrada o lista para registrarse, una contabilidad que lleva usted mismo y un plan de comunicación escrito.',
      },
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Avis (§12.4) — moderated, from the demonstration students
// ═══════════════════════════════════════════════════════════════════════════

interface SeedReview {
  readonly courseSlug: string;
  readonly studentEmail: string;
  /** 1–5. The distribution below is deliberately not all fives. */
  readonly rating: number;
  readonly comment: string;
  readonly status: ReviewStatus;
  readonly adminReply?: string;
  readonly daysAgo: number;
}

const REVIEWS: readonly SeedReview[] = [
  {
    courseSlug: 'marketing-digital-fondations',
    studentEmail: 'imane.chraibi@gmail.com',
    rating: 5,
    comment:
      "Je suis arrivée sans rien connaître et je suis repartie avec un plan que j'applique toujours six mois après. Le formateur travaille sur vos propres chiffres, pas sur des exemples américains.",
    status: ReviewStatus.APPROVED,
    daysAgo: 62,
  },
  {
    courseSlug: 'marketing-digital-fondations',
    studentEmail: 'mehdi.berrada@gmail.com',
    rating: 4,
    comment:
      "Contenu très clair et bien rythmé. J'aurais aimé une séance de plus sur la publicité, mais c'est le sujet de la formation suivante, donc c'est cohérent.",
    status: ReviewStatus.APPROVED,
    daysAgo: 55,
  },
  {
    courseSlug: 'marketing-digital-fondations',
    studentEmail: 'hajar.naciri@gmail.com',
    rating: 5,
    comment:
      "Le module sur la fiche Google et les avis m'a rapporté plus de demandes en trois semaines que ma page Instagram en un an. Rien que pour ça, la formation est rentabilisée.",
    status: ReviewStatus.APPROVED,
    daysAgo: 34,
  },
  {
    courseSlug: 'marketing-digital-fondations',
    studentEmail: 'othmane.sbai@gmail.com',
    rating: 4,
    comment:
      'Bon équilibre entre les séances au centre et le travail à distance. Les corrections sont personnalisées, ce qui est rare.',
    status: ReviewStatus.APPROVED,
    daysAgo: 28,
  },
  {
    courseSlug: 'publicite-en-ligne-meta-et-google-ads',
    studentEmail: 'mehdi.berrada@gmail.com',
    rating: 5,
    comment:
      "On ouvre le compte publicitaire dès la deuxième séance et on ne le referme plus. J'ai divisé mon coût par contact par deux avec la structure de campagne vue au module 2.",
    status: ReviewStatus.APPROVED,
    daysAgo: 41,
  },
  {
    courseSlug: 'publicite-en-ligne-meta-et-google-ads',
    studentEmail: 'anas.idrissi@gmail.com',
    rating: 4,
    comment:
      'Exigeant, et il faut vraiment prévoir un budget de test comme annoncé. Mais la partie mesure des conversions vaut à elle seule le prix.',
    status: ReviewStatus.APPROVED,
    daysAgo: 30,
  },
  {
    courseSlug: 'publicite-en-ligne-meta-et-google-ads',
    studentEmail: 'othmane.sbai@gmail.com',
    rating: 3,
    comment:
      "Le contenu est solide mais le rythme est rapide pour quelqu'un qui découvre les comptes publicitaires. J'ai dû revoir deux modules deux fois.",
    status: ReviewStatus.APPROVED,
    adminReply:
      "Merci pour ce retour. Nous avons ajouté une séance de rattrapage optionnelle en début de parcours pour les participants qui n'ont jamais géré de compte publicitaire.",
    daysAgo: 19,
  },
  {
    courseSlug: 'developpement-web-html-css-javascript',
    studentEmail: 'sara.elfassi@outlook.com',
    rating: 5,
    comment:
      "Trois mois intenses, mais mon site est en ligne et je sais le modifier seule. La revue de code à chaque module change tout : on ne reste jamais bloqué une semaine.",
    status: ReviewStatus.APPROVED,
    daysAgo: 47,
  },
  {
    courseSlug: 'developpement-web-html-css-javascript',
    studentEmail: 'anas.idrissi@gmail.com',
    rating: 5,
    comment:
      "Le groupe est petit, la formatrice passe derrière chacun. Le projet final défendu devant le groupe est stressant et c'est exactement ce qu'il fallait.",
    status: ReviewStatus.APPROVED,
    daysAgo: 39,
  },
  {
    courseSlug: 'developpement-web-html-css-javascript',
    studentEmail: 'mehdi.berrada@gmail.com',
    rating: 4,
    comment:
      "Prévoyez vraiment les cinq heures de travail personnel par semaine, sinon on décroche au module JavaScript. Rien à redire sur le contenu.",
    status: ReviewStatus.APPROVED,
    daysAgo: 22,
  },
  {
    courseSlug: 'react-et-next-js-applications-web',
    studentEmail: 'othmane.sbai@gmail.com',
    rating: 4,
    comment:
      "Formation avancée, comme annoncé. La partie composants serveur m'a enfin fait comprendre pourquoi mes pages étaient lentes.",
    status: ReviewStatus.APPROVED,
    daysAgo: 26,
  },
  {
    courseSlug: 'react-et-next-js-applications-web',
    studentEmail: 'mehdi.berrada@gmail.com',
    rating: 5,
    comment:
      "La revue de code hebdomadaire sur mon propre dépôt vaut dix tutoriels. J'ai été pris en stage avant la fin de la formation.",
    status: ReviewStatus.APPROVED,
    daysAgo: 12,
  },
  {
    courseSlug: 'ui-ux-concevoir-des-interfaces-utilisables',
    studentEmail: 'imane.chraibi@gmail.com',
    rating: 5,
    comment:
      "Le module sur le bilinguisme arabe-français est introuvable ailleurs. J'ai refait toute ma maquette en début et fin plutôt qu'en gauche et droite.",
    status: ReviewStatus.APPROVED,
    daysAgo: 33,
  },
  {
    courseSlug: 'ui-ux-concevoir-des-interfaces-utilisables',
    studentEmail: 'sara.elfassi@outlook.com',
    rating: 4,
    comment:
      "Très bonne formation, avec un vrai cas suivi du début à la fin. Le test avec cinq utilisateurs m'a montré des évidences que je ne voyais plus.",
    status: ReviewStatus.APPROVED,
    daysAgo: 18,
  },
  {
    courseSlug: 'francais-professionnel-ecrire-au-travail',
    studentEmail: 'hajar.naciri@gmail.com',
    rating: 5,
    comment:
      "On travaille sur ses propres e-mails, anonymisés. C'est déstabilisant la première séance et très efficace ensuite. Mes relances obtiennent enfin des réponses.",
    status: ReviewStatus.APPROVED,
    daysAgo: 44,
  },
  {
    courseSlug: 'francais-professionnel-ecrire-au-travail',
    studentEmail: 'sara.elfassi@outlook.com',
    rating: 3,
    comment:
      "Utile pour les e-mails et les comptes rendus, moins pour la partie candidature qui est allée un peu vite. Le niveau du groupe était assez inégal.",
    status: ReviewStatus.APPROVED,
    daysAgo: 25,
  },
  {
    courseSlug: 'creer-son-entreprise-au-maroc',
    studentEmail: 'othmane.sbai@gmail.com',
    rating: 5,
    comment:
      "Les deux séances avec le comptable et le banquier valent le déplacement à elles seules. Je suis reparti avec ma liste de démarches datée et je l'ai suivie.",
    status: ReviewStatus.APPROVED,
    daysAgo: 51,
  },
  {
    courseSlug: 'creer-son-entreprise-au-maroc',
    studentEmail: 'anas.idrissi@gmail.com',
    rating: 2,
    comment:
      "Le contenu est bon mais deux montants cités en séance n'étaient plus à jour, et j'ai perdu un déplacement à cause de ça. À vérifier avant chaque session.",
    status: ReviewStatus.APPROVED,
    adminReply:
      "Vous avez raison et nous en sommes désolés. Les seuils et les pièces exigées sont désormais revérifiés auprès du comptable intervenant avant chaque session, et la fiche de démarches est datée. Contactez-nous, nous vous proposons de refaire la séance concernée.",
    daysAgo: 16,
  },
  {
    courseSlug: 'comptabilite-et-gestion-d-une-tpe',
    studentEmail: 'imane.chraibi@gmail.com',
    rating: 4,
    comment:
      "Je comprends enfin ce que mon comptable m'envoie et je peux discuter avec lui. Le tableau de trésorerie à treize semaines est devenu mon outil du lundi matin.",
    status: ReviewStatus.APPROVED,
    daysAgo: 29,
  },
  {
    courseSlug: 'excel-de-zero-a-l-analyse',
    studentEmail: 'hajar.naciri@gmail.com',
    rating: 5,
    comment:
      "Cours donné en arabe avec les supports en français : c'était exactement ce qu'il me fallait. Les cinq règles de saisie ont sauvé mes fichiers de stock.",
    status: ReviewStatus.APPROVED,
    daysAgo: 37,
  },
  {
    courseSlug: 'excel-de-zero-a-l-analyse',
    studentEmail: 'mehdi.berrada@gmail.com',
    rating: 5,
    comment:
      "Je croyais connaître Excel. Les tableaux croisés dynamiques m'ont fait gagner une demi-journée par mois, mesurée.",
    status: ReviewStatus.APPROVED,
    daysAgo: 24,
  },
  {
    courseSlug: 'excel-de-zero-a-l-analyse',
    studentEmail: 'imane.chraibi@gmail.com',
    rating: 4,
    comment:
      'Rythme adapté aux débutants et beaucoup de pratique. Le dernier module sur les raccourcis aurait mérité plus de temps.',
    status: ReviewStatus.APPROVED,
    daysAgo: 15,
  },
  {
    courseSlug: 'ia-generative-au-quotidien',
    studentEmail: 'sara.elfassi@outlook.com',
    rating: 5,
    comment:
      "Enfin une formation qui explique quoi ne pas envoyer à ces outils. La partie vérification des réponses devrait être obligatoire dans toutes les entreprises.",
    status: ReviewStatus.APPROVED,
    daysAgo: 11,
  },
  {
    courseSlug: 'ia-generative-au-quotidien',
    studentEmail: 'anas.idrissi@gmail.com',
    rating: 4,
    comment:
      'Très concret, avec des cas de bureau réels. La bibliothèque de consignes construite en fin de parcours sert tous les jours.',
    status: ReviewStatus.APPROVED,
    daysAgo: 7,
  },

  // Deux avis encore en modération — la file d'attente de l'admin (§17)
  {
    courseSlug: 'ui-ux-concevoir-des-interfaces-utilisables',
    studentEmail: 'mehdi.berrada@gmail.com',
    rating: 4,
    comment:
      "Bonne formation. Je mets quatre parce que j'aurais aimé plus d'exercices sur les composants Figma, le reste est excellent.",
    status: ReviewStatus.PENDING,
    daysAgo: 2,
  },
  {
    courseSlug: 'ia-generative-au-quotidien',
    studentEmail: 'hajar.naciri@gmail.com',
    rating: 5,
    comment:
      "J'ai automatisé le dépouillement de nos questionnaires de satisfaction. Deux jours de travail par trimestre en moins.",
    status: ReviewStatus.PENDING,
    daysAgo: 1,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Writing
// ═══════════════════════════════════════════════════════════════════════════

/** Locales actually filled in on a partially translated title. */
function localesOf(text: PartialText): readonly Locale[] {
  return ALL_LOCALES.filter((locale) => text[locale] !== undefined);
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

/**
 * Fails the run on data mistakes the database itself would happily accept — a
 * duplicate slug, a published course with no preview lesson, a struck-through
 * price below the real one, a bundle that costs more than its parts. Cheaper to
 * catch here than on the live site, and every problem is reported at once so a
 * bad edit takes one round trip instead of ten.
 */
export function assertCatalogIsSound(): void {
  const problems: string[] = [];
  const slugs = new Set<string>();

  for (const course of COURSES) {
    if (slugs.has(course.slug)) problems.push(`Slug de cours en double : ${course.slug}.`);
    slugs.add(course.slug);

    if (course.modules.length < 4 || course.modules.length > 6) {
      problems.push(
        `${course.slug} a ${course.modules.length} modules ; le format du centre en prévoit 4 à 6 (§23).`,
      );
    }
    for (const courseModule of course.modules) {
      if (courseModule.lessons.length < 4 || courseModule.lessons.length > 8) {
        problems.push(
          `${course.slug} · module « ${courseModule.title.fr} » : ${courseModule.lessons.length} leçons, il en faut 4 à 8 (§23).`,
        );
      }
    }

    const lessons = course.modules.flatMap((courseModule) => courseModule.lessons);
    if (course.status === CourseStatus.PUBLISHED) {
      const previews = lessons.filter((lesson) => lesson.isPreview === true).length;
      if (previews < 2 || previews > 3) {
        problems.push(
          `Le cours publié ${course.slug} a ${previews} leçon(s) en aperçu ; il en faut 2 à 3 (§12.4).`,
        );
      }
    }
    for (const lesson of lessons) {
      if (lesson.type === LessonType.ARTICLE && lesson.content === undefined) {
        problems.push(`${course.slug} · « ${lesson.title.fr} » est de type ARTICLE sans contenu.`);
      }
      if (lesson.minutes <= 0) {
        problems.push(`${course.slug} · « ${lesson.title.fr} » n'a pas de durée.`);
      }
    }
    if (course.maxSeats !== undefined && course.maxSeats <= 0) {
      problems.push(`maxSeats invalide pour ${course.slug}.`);
    }
    if (
      course.comparePriceCentimes !== undefined &&
      course.comparePriceCentimes <= course.priceCentimes
    ) {
      problems.push(
        `Le prix barré de ${course.slug} n'est pas supérieur au prix réel : rien à barrer.`,
      );
    }
  }

  const priceBySlug = new Map(COURSES.map((course) => [course.slug, course.priceCentimes] as const));
  for (const path of PATHS) {
    let sum = 0;
    for (const slug of path.courseSlugs) {
      const price = priceBySlug.get(slug);
      if (price === undefined) {
        problems.push(`Le parcours ${path.slug} référence un cours inconnu : ${slug}.`);
        continue;
      }
      sum += price;
    }
    if (path.priceCentimes >= sum) {
      problems.push(
        `Le parcours ${path.slug} coûte ${path.priceCentimes} centimes pour ${sum} centimes de cours : ce n'est pas une offre groupée.`,
      );
    }
  }

  for (const review of REVIEWS) {
    if (review.rating < 1 || review.rating > 5) {
      problems.push(`Note invalide (${review.rating}) sur ${review.courseSlug}.`);
    }
    if (!slugs.has(review.courseSlug)) {
      problems.push(`Avis rattaché à un cours inconnu : ${review.courseSlug}.`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Le catalogue de démonstration est incohérent :\n  - ${problems.join('\n  - ')}`,
    );
  }
}

export async function seedCatalog(tx: Prisma.TransactionClient): Promise<CatalogGroupResult> {
  assertCatalogIsSound();

  // ── Références ──────────────────────────────────────────────────────────
  const categoryIdBySlug = new Map(
    (await tx.category.findMany({ select: { id: true, slug: true } })).map(
      (row) => [row.slug, row.id] as const,
    ),
  );

  const wantedEmails = [
    ...new Set([
      ...COURSES.map((course) => course.instructorEmail).filter(
        (email): email is string => email !== null,
      ),
      ...REVIEWS.map((review) => review.studentEmail),
    ]),
  ];
  const userIdByEmail = new Map(
    (
      await tx.user.findMany({
        where: { email: { in: wantedEmails } },
        select: { id: true, email: true },
      })
    ).map((row) => [row.email, row.id] as const),
  );
  for (const email of wantedEmails) {
    if (!userIdByEmail.has(email)) {
      throw new Error(
        `Le compte ${email} est absent : lancez d'abord le groupe « Comptes » du seed principal.`,
      );
    }
  }

  // ── Clés existantes, pour distinguer création et mise à jour ────────────
  const existingCourseSlugs = new Set(
    (await tx.course.findMany({ select: { slug: true } })).map((row) => row.slug),
  );
  const existingPathSlugs = new Set(
    (await tx.path.findMany({ select: { slug: true } })).map((row) => row.slug),
  );
  const existingCourseTranslations = new Set(
    (await tx.courseTranslation.findMany({ select: { courseId: true, locale: true } })).map(
      (row) => `${row.courseId}:${row.locale}`,
    ),
  );
  const existingModules = new Set(
    (await tx.module.findMany({ select: { courseId: true, order: true } })).map(
      (row) => `${row.courseId}:${row.order}`,
    ),
  );
  const existingLessons = new Set(
    (await tx.lesson.findMany({ select: { moduleId: true, order: true } })).map(
      (row) => `${row.moduleId}:${row.order}`,
    ),
  );
  const existingModuleTranslations = new Set(
    (await tx.moduleTranslation.findMany({ select: { moduleId: true, locale: true } })).map(
      (row) => `${row.moduleId}:${row.locale}`,
    ),
  );
  const existingLessonTranslations = new Set(
    (await tx.lessonTranslation.findMany({ select: { lessonId: true, locale: true } })).map(
      (row) => `${row.lessonId}:${row.locale}`,
    ),
  );
  const existingPathTranslations = new Set(
    (await tx.pathTranslation.findMany({ select: { pathId: true, locale: true } })).map(
      (row) => `${row.pathId}:${row.locale}`,
    ),
  );
  const existingReviews = new Set(
    (await tx.review.findMany({ select: { courseId: true, userId: true } })).map(
      (row) => `${row.courseId}:${row.userId}`,
    ),
  );

  const courses = new Counter();
  const translations = new Counter();
  const modules = new Counter();
  const lessons = new Counter();
  const paths = new Counter();
  const reviews = new Counter();

  const courseIdBySlug = new Map<string, string>();

  // ── Cours, modules, leçons ──────────────────────────────────────────────
  for (const course of COURSES) {
    const categoryId = required(
      categoryIdBySlug.get(course.categorySlug),
      `Catégorie inconnue : ${course.categorySlug}.`,
    );
    const instructorId =
      course.instructorEmail === null
        ? null
        : required(userIdByEmail.get(course.instructorEmail), `Formateur inconnu.`);

    const allLessons = course.modules.flatMap((courseModule) => courseModule.lessons);
    const shared = {
      categoryId,
      instructorId,
      status: course.status,
      level: course.level,
      deliveryMode: course.deliveryMode,
      contentLocale: course.contentLocale,
      priceCentimes: course.priceCentimes,
      comparePriceCentimes: course.comparePriceCentimes ?? null,
      installmentsAllowed: course.installmentCount !== undefined,
      installmentCount: course.installmentCount ?? null,
      coverKey: coverKeyFor(course.slug),
      durationMinutes: allLessons.reduce((total, lesson) => total + lesson.minutes, 0),
      lessonCount: allLessons.length,
      isFeatured: course.isFeatured ?? false,
      isNew: course.isNew ?? false,
      certificateEnabled: true,
      passingScore: course.passingScore ?? 70,
      accessDurationDays: course.accessDurationDays ?? null,
      maxSeats: course.maxSeats ?? null,
      publishedAt:
        course.status === CourseStatus.PUBLISHED && course.publishedDaysAgo !== undefined
          ? daysAgo(course.publishedDaysAgo)
          : null,
      archivedAt: null,
    };

    const row = await tx.course.upsert({
      where: { slug: course.slug },
      create: { slug: course.slug, ...shared },
      update: shared,
      select: { id: true },
    });
    courseIdBySlug.set(course.slug, row.id);
    courses.record(existingCourseSlugs.has(course.slug));

    for (const locale of ALL_LOCALES) {
      const text = course.text[locale];
      const payload = {
        title: text.title,
        subtitle: text.subtitle,
        description: text.description,
        objectives: [...text.objectives],
        targetAudience: [...text.audience],
        requirementsText: [...text.requirements],
        seoTitle: text.seoTitle,
        seoDescription: text.seoDescription,
        isComplete: course.completeLocales.includes(locale),
      };
      await tx.courseTranslation.upsert({
        where: { courseId_locale: { courseId: row.id, locale } },
        create: { courseId: row.id, locale, ...payload },
        update: payload,
      });
      translations.record(existingCourseTranslations.has(`${row.id}:${locale}`));
    }

    // Modules retirés du fichier depuis la dernière exécution. Les rangs sont
    // 1-indexés, comme le reste du seed (catégories, FAQ, témoignages).
    await tx.module.deleteMany({
      where: { courseId: row.id, order: { gt: course.modules.length } },
    });

    for (const [moduleIndex, courseModule] of course.modules.entries()) {
      const moduleOrder = moduleIndex + 1;
      const moduleRow = await tx.module.upsert({
        where: { courseId_order: { courseId: row.id, order: moduleOrder } },
        create: { courseId: row.id, order: moduleOrder, isPublished: true },
        update: { isPublished: true },
        select: { id: true },
      });
      const moduleExisted = existingModules.has(`${row.id}:${moduleOrder}`);
      modules.record(moduleExisted);

      const moduleLocales = localesOf(courseModule.title);
      for (const locale of moduleLocales) {
        const title = required(courseModule.title[locale], 'Titre de module manquant.');
        const summary = courseModule.summary?.[locale] ?? null;
        await tx.moduleTranslation.upsert({
          where: { moduleId_locale: { moduleId: moduleRow.id, locale } },
          create: { moduleId: moduleRow.id, locale, title, summary },
          update: { title, summary },
        });
        translations.record(existingModuleTranslations.has(`${moduleRow.id}:${locale}`));
      }
      // Une locale retirée du fichier doit disparaître de la base. Inutile de
      // le demander pour une ligne qui vient d'être créée, ni quand les quatre
      // locales sont présentes : cela ferait 276 allers-retours pour rien sur
      // une première exécution, qui est justement celle qui a le moins de
      // budget de transaction.
      if (moduleExisted && moduleLocales.length < ALL_LOCALES.length) {
        await tx.moduleTranslation.deleteMany({
          where: { moduleId: moduleRow.id, locale: { notIn: [...moduleLocales] } },
        });
      }

      await tx.lesson.deleteMany({
        where: { moduleId: moduleRow.id, order: { gt: courseModule.lessons.length } },
      });

      for (const [lessonIndex, lesson] of courseModule.lessons.entries()) {
        const lessonOrder = lessonIndex + 1;
        const lessonShared = {
          type: lesson.type,
          isPreview: lesson.isPreview ?? false,
          isPublished: true,
          isMandatory: lesson.isMandatory ?? true,
          estimatedMinutes: lesson.minutes,
        };
        const lessonRow = await tx.lesson.upsert({
          where: { moduleId_order: { moduleId: moduleRow.id, order: lessonOrder } },
          create: { moduleId: moduleRow.id, order: lessonOrder, ...lessonShared },
          update: lessonShared,
          select: { id: true },
        });
        const lessonExisted = existingLessons.has(`${moduleRow.id}:${lessonOrder}`);
        lessons.record(lessonExisted);

        const lessonLocales = localesOf(lesson.title);
        for (const locale of lessonLocales) {
          const title = required(lesson.title[locale], 'Titre de leçon manquant.');
          const content = lesson.content?.[locale] ?? null;
          await tx.lessonTranslation.upsert({
            where: { lessonId_locale: { lessonId: lessonRow.id, locale } },
            create: { lessonId: lessonRow.id, locale, title, content },
            update: { title, content },
          });
          translations.record(existingLessonTranslations.has(`${lessonRow.id}:${locale}`));
        }
        if (lessonExisted && lessonLocales.length < ALL_LOCALES.length) {
          await tx.lessonTranslation.deleteMany({
            where: { lessonId: lessonRow.id, locale: { notIn: [...lessonLocales] } },
          });
        }
      }
    }
  }

  step(
    `Cours : ${courses.created} créé(s), ${courses.updated} mis à jour ` +
      `(${COURSES.filter((course) => course.status === CourseStatus.PUBLISHED).length} publiés, ` +
      `${COURSES.filter((course) => course.status === CourseStatus.DRAFT).length} brouillons).`,
  );
  step(
    `Modules : ${modules.total} · leçons : ${lessons.total} · ` +
      `traductions (cours, modules, leçons) : ${translations.total}.`,
  );

  // ── Parcours ────────────────────────────────────────────────────────────
  for (const path of PATHS) {
    const courseIds = path.courseSlugs.map((slug) =>
      required(courseIdBySlug.get(slug), `Parcours ${path.slug} : cours ${slug} introuvable.`),
    );

    const shared = {
      priceCentimes: path.priceCentimes,
      coverKey: `seed/paths/${path.slug}.jpg`,
      status: CourseStatus.PUBLISHED,
      isFeatured: path.isFeatured,
    };
    const pathRow = await tx.path.upsert({
      where: { slug: path.slug },
      create: { slug: path.slug, ...shared },
      update: shared,
      select: { id: true },
    });
    paths.record(existingPathSlugs.has(path.slug));

    for (const locale of ALL_LOCALES) {
      const text = path.text[locale];
      const payload = {
        title: text.title,
        description: text.description,
        outcome: text.outcome,
      };
      await tx.pathTranslation.upsert({
        where: { pathId_locale: { pathId: pathRow.id, locale } },
        create: { pathId: pathRow.id, locale, ...payload },
        update: payload,
      });
      translations.record(existingPathTranslations.has(`${pathRow.id}:${locale}`));
    }

    for (const [index, courseId] of courseIds.entries()) {
      await tx.pathItem.upsert({
        where: { pathId_courseId: { pathId: pathRow.id, courseId } },
        create: { pathId: pathRow.id, courseId, order: index + 1 },
        update: { order: index + 1 },
      });
    }
    await tx.pathItem.deleteMany({
      where: { pathId: pathRow.id, courseId: { notIn: courseIds } },
    });
  }

  step(`Parcours : ${paths.created} créé(s), ${paths.updated} mis à jour.`);

  // ── Avis, puis les moyennes qu'ils produisent ───────────────────────────
  for (const review of REVIEWS) {
    const courseId = required(
      courseIdBySlug.get(review.courseSlug),
      `Avis sur un cours introuvable : ${review.courseSlug}.`,
    );
    const userId = required(
      userIdByEmail.get(review.studentEmail),
      `Avis d'un compte introuvable : ${review.studentEmail}.`,
    );
    const shared = {
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      adminReply: review.adminReply ?? null,
    };
    await tx.review.upsert({
      where: { courseId_userId: { courseId, userId } },
      create: { courseId, userId, createdAt: daysAgo(review.daysAgo), ...shared },
      update: shared,
    });
    reviews.record(existingReviews.has(`${courseId}:${userId}`));
  }

  for (const courseId of courseIdBySlug.values()) {
    const aggregate = await tx.review.aggregate({
      where: { courseId, status: ReviewStatus.APPROVED },
      _avg: { rating: true },
      _count: true,
    });
    const average = aggregate._avg.rating ?? 0;
    await tx.course.update({
      where: { id: courseId },
      data: {
        ratingAvg: Math.round(average * 100) / 100,
        ratingCount: aggregate._count,
      },
    });
  }

  const approved = REVIEWS.filter((review) => review.status === ReviewStatus.APPROVED).length;
  step(
    `Avis : ${reviews.created} créé(s), ${reviews.updated} mis à jour ` +
      `(${approved} approuvés, ${REVIEWS.length - approved} en modération). Moyennes recalculées.`,
  );

  const created = courses.created + translations.created + modules.created + lessons.created + paths.created + reviews.created;
  const updated = courses.updated + translations.updated + modules.updated + lessons.updated + paths.updated + reviews.updated;

  return {
    label: 'Catalogue (cours, modules, leçons, parcours, avis)',
    created,
    updated,
    preserved: 0,
  };
}
