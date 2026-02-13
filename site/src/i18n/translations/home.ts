export const home: Record<string, {
  hero: {
    badge: string;
    title: string;
    titleAccent: string;
    description: string;
    cta: string;
    ctaSecondary: string;
  };
  features: {
    heading: string;
    subtitle: string;
    items: Array<{ icon: string; title: string; description: string }>;
  };
  security: {
    heading: string;
    description: string;
    link: string;
  };
  deploy: {
    heading: string;
    description: string;
    cta: string;
    github: string;
  };
}> = {
  en: {
    hero: {
      badge: 'Open source \u00b7 End-to-end encrypted',
      title: 'Secure crisis hotline',
      titleAccent: 'for the people who need it',
      description: 'Llámenos is open-source hotline software that protects callers and volunteers. Encrypted notes, real-time call routing, and a zero-knowledge architecture \u2014 so sensitive conversations stay private.',
      cta: 'Get started',
      ctaSecondary: 'Read the security model',
    },
    features: {
      heading: 'Built for crisis response',
      subtitle: 'Everything a hotline needs \u2014 call routing, encrypted note-taking, shift management, and admin tools \u2014 in a single open-source package.',
      items: [
        { icon: '\u{1F512}', title: 'End-to-end encrypted notes', description: 'Call notes and transcripts are encrypted client-side before leaving the browser. The server only stores ciphertext.' },
        { icon: '\u{1F4DE}', title: 'Parallel call ringing', description: 'Incoming calls ring all on-shift volunteers simultaneously. First pickup wins. No calls missed.' },
        { icon: '\u{1F30D}', title: '12+ languages built in', description: 'Full UI translations for English, Spanish, Chinese, Tagalog, Vietnamese, Arabic, French, Haitian Creole, Korean, Russian, Hindi, and Portuguese.' },
        { icon: '\u{1F399}', title: 'AI transcription', description: 'Whisper-powered call transcription with end-to-end encryption. Admin and volunteer can toggle independently.' },
        { icon: '\u{1F6E1}', title: 'Spam mitigation', description: 'Voice CAPTCHA, rate limiting, and real-time ban lists. Admins toggle protections without restarting.' },
        { icon: '\u{1F4F1}', title: 'Mobile-first PWA', description: 'Works on any device. Installable as an app. Push notifications for incoming calls.' },
      ],
    },
    security: {
      heading: 'Honest about security',
      description: "We publish exactly what is encrypted, what isn't, and what the server can see. No hand-waving. Voice calls still traverse your telephony provider's infrastructure (unless you self-host with Asterisk), and we say so upfront. Read the full security model to understand the threat landscape and our roadmap for closing gaps.",
      link: 'Read the security model',
    },
    deploy: {
      heading: 'Ready to deploy?',
      description: 'Llámenos runs on Cloudflare Workers with zero infrastructure to manage. Get a hotline running in under an hour.',
      cta: 'Get started',
      github: 'View on GitHub',
    },
  },
  es: {
    hero: {
      badge: 'Código abierto \u00b7 Cifrado de extremo a extremo',
      title: 'Línea de crisis segura',
      titleAccent: 'para quienes la necesitan',
      description: 'Llámenos es un software de línea de ayuda de código abierto que protege a quienes llaman y a los voluntarios. Notas cifradas, enrutamiento de llamadas en tiempo real y una arquitectura de conocimiento cero \u2014 para que las conversaciones sensibles permanezcan privadas.',
      cta: 'Comenzar',
      ctaSecondary: 'Leer el modelo de seguridad',
    },
    features: {
      heading: 'Diseñado para respuesta a crisis',
      subtitle: 'Todo lo que una línea de ayuda necesita \u2014 enrutamiento de llamadas, notas cifradas, gestión de turnos y herramientas de administración \u2014 en un solo paquete de código abierto.',
      items: [
        { icon: '\u{1F512}', title: 'Notas cifradas de extremo a extremo', description: 'Las notas y transcripciones se cifran en el navegador antes de salir del dispositivo. El servidor solo almacena texto cifrado.' },
        { icon: '\u{1F4DE}', title: 'Timbre paralelo', description: 'Las llamadas entrantes suenan en todos los voluntarios de turno simultáneamente. El primero en contestar obtiene la llamada.' },
        { icon: '\u{1F30D}', title: 'Más de 12 idiomas integrados', description: 'Traducciones completas de la interfaz para inglés, español, chino, tagalo, vietnamita, árabe, francés, criollo haitiano, coreano, ruso, hindi y portugués.' },
        { icon: '\u{1F399}', title: 'Transcripción con IA', description: 'Transcripción de llamadas con Whisper y cifrado de extremo a extremo. El administrador y el voluntario pueden activarla independientemente.' },
        { icon: '\u{1F6E1}', title: 'Mitigación de spam', description: 'CAPTCHA de voz, limitación de tasa y listas de bloqueo en tiempo real. Los administradores activan las protecciones sin reiniciar.' },
        { icon: '\u{1F4F1}', title: 'PWA móvil primero', description: 'Funciona en cualquier dispositivo. Instalable como aplicación. Notificaciones push para llamadas entrantes.' },
      ],
    },
    security: {
      heading: 'Honestos sobre la seguridad',
      description: 'Publicamos exactamente qué está cifrado, qué no lo está y qué puede ver el servidor. Sin ambigüedades. Las llamadas de voz pasan por la infraestructura de tu proveedor de telefonía (a menos que autoalojes con Asterisk), y lo decimos abiertamente. Lee el modelo de seguridad completo para entender el panorama de amenazas y nuestra hoja de ruta.',
      link: 'Leer el modelo de seguridad',
    },
    deploy: {
      heading: '¿Listo para desplegar?',
      description: 'Llámenos funciona en Cloudflare Workers sin infraestructura que gestionar. Pon en marcha una línea de ayuda en menos de una hora.',
      cta: 'Comenzar',
      github: 'Ver en GitHub',
    },
  },
  zh: {
    hero: {
      badge: '开源 \u00b7 端到端加密',
      title: '安全的危机热线',
      titleAccent: '为需要帮助的人而建',
      description: 'Llámenos 是保护来电者和志愿者的开源热线软件。加密笔记、实时呼叫路由和零知识架构——确保敏感对话保持私密。',
      cta: '开始使用',
      ctaSecondary: '阅读安全模型',
    },
    features: {
      heading: '专为危机响应打造',
      subtitle: '热线所需的一切——呼叫路由、加密笔记、排班管理和管理工具——集于一个开源项目。',
      items: [
        { icon: '\u{1F512}', title: '端到端加密笔记', description: '通话笔记和转录在离开浏览器前在客户端加密。服务器只存储密文。' },
        { icon: '\u{1F4DE}', title: '并行振铃', description: '来电同时响铃所有在班志愿者。第一个接听的人获得通话，其他停止振铃。' },
        { icon: '\u{1F30D}', title: '内置12+种语言', description: '完整的界面翻译，支持英语、西班牙语、中文、他加禄语、越南语、阿拉伯语、法语、海地克里奥尔语、韩语、俄语、印地语和葡萄牙语。' },
        { icon: '\u{1F399}', title: 'AI 转录', description: '基于 Whisper 的通话转录，端到端加密。管理员和志愿者可独立切换。' },
        { icon: '\u{1F6E1}', title: '垃圾来电防护', description: '语音 CAPTCHA、速率限制和实时封禁列表。管理员无需重启即可切换保护。' },
        { icon: '\u{1F4F1}', title: '移动优先 PWA', description: '适用于任何设备。可安装为应用。来电推送通知。' },
      ],
    },
    security: {
      heading: '坦诚的安全声明',
      description: '我们准确公布哪些内容已加密、哪些未加密以及服务器能看到什么。绝不含糊。语音通话仍经过您的电话服务提供商的基础设施（除非您使用 Asterisk 自建），我们坦言这一点。阅读完整的安全模型以了解威胁格局和我们的改进路线图。',
      link: '阅读安全模型',
    },
    deploy: {
      heading: '准备好部署了吗？',
      description: 'Llámenos 运行在 Cloudflare Workers 上，无需管理基础设施。不到一小时即可启动热线。',
      cta: '开始使用',
      github: '在 GitHub 上查看',
    },
  },
  tl: {
    hero: {
      badge: 'Open source \u00b7 End-to-end encrypted',
      title: 'Secure na crisis hotline',
      titleAccent: 'para sa mga nangangailangan',
      description: 'Ang Llámenos ay open-source na hotline software na nagpoprotekta sa mga tumatawag at mga volunteer. Encrypted na mga tala, real-time na call routing, at zero-knowledge architecture \u2014 para manatiling pribado ang mga sensitibong usapan.',
      cta: 'Magsimula',
      ctaSecondary: 'Basahin ang modelo ng seguridad',
    },
    features: {
      heading: 'Ginawa para sa crisis response',
      subtitle: 'Lahat ng kailangan ng isang hotline \u2014 call routing, encrypted na pagsusulat ng tala, pamamahala ng shift, at admin tools \u2014 sa isang open-source na pakete.',
      items: [
        { icon: '\u{1F512}', title: 'End-to-end encrypted na mga tala', description: 'Ang mga tala at transkripsyon ay naka-encrypt sa browser bago umalis sa device. Ciphertext lang ang nakaimbak sa server.' },
        { icon: '\u{1F4DE}', title: 'Sabay-sabay na pag-ring', description: 'Ang mga papasok na tawag ay nagri-ring sa lahat ng on-shift na volunteer nang sabay-sabay. Unang sumagot, siya ang makakausap.' },
        { icon: '\u{1F30D}', title: '12+ na wika ang built-in', description: 'Kumpletong pagsasalin ng UI para sa Ingles, Espanyol, Tsino, Tagalog, Vietnamese, Arabe, Pranses, Haitian Creole, Korean, Ruso, Hindi, at Portuges.' },
        { icon: '\u{1F399}', title: 'AI na transkripsyon', description: 'Transkripsyon ng tawag gamit ang Whisper na may end-to-end encryption. Maaaring i-toggle ng admin at volunteer nang hiwalay.' },
        { icon: '\u{1F6E1}', title: 'Proteksyon laban sa spam', description: 'Voice CAPTCHA, rate limiting, at real-time na ban list. Maaaring i-toggle ng mga admin ang proteksyon nang hindi nire-restart.' },
        { icon: '\u{1F4F1}', title: 'Mobile-first PWA', description: 'Gumagana sa anumang device. Maaaring i-install bilang app. Push notification para sa papasok na tawag.' },
      ],
    },
    security: {
      heading: 'Tapat tungkol sa seguridad',
      description: 'Inilalathala namin nang eksakto kung ano ang naka-encrypt, ano ang hindi, at ano ang nakikita ng server. Walang pambubulag. Ang mga voice call ay dumadaan pa rin sa imprastruktura ng iyong telephony provider (maliban kung self-host ka gamit ang Asterisk), at sinasabi namin ito nang tapat.',
      link: 'Basahin ang modelo ng seguridad',
    },
    deploy: {
      heading: 'Handa nang mag-deploy?',
      description: 'Ang Llámenos ay tumatakbo sa Cloudflare Workers na walang imprastrukturang kailangang pamahalaan. Magpatakbo ng hotline sa loob ng isang oras.',
      cta: 'Magsimula',
      github: 'Tingnan sa GitHub',
    },
  },
  vi: {
    hero: {
      badge: 'Mã nguồn mở \u00b7 Mã hóa đầu cuối',
      title: 'Đường dây nóng khủng hoảng an toàn',
      titleAccent: 'cho những người cần nó',
      description: 'Llámenos là phần mềm đường dây nóng mã nguồn mở bảo vệ người gọi và tình nguyện viên. Ghi chú được mã hóa, định tuyến cuộc gọi thời gian thực và kiến trúc không tiết lộ \u2014 để các cuộc trò chuyện nhạy cảm luôn riêng tư.',
      cta: 'Bắt đầu',
      ctaSecondary: 'Đọc mô hình bảo mật',
    },
    features: {
      heading: 'Xây dựng cho ứng phó khủng hoảng',
      subtitle: 'Mọi thứ một đường dây nóng cần \u2014 định tuyến cuộc gọi, ghi chú mã hóa, quản lý ca trực và công cụ quản trị \u2014 trong một gói mã nguồn mở.',
      items: [
        { icon: '\u{1F512}', title: 'Ghi chú mã hóa đầu cuối', description: 'Ghi chú và bản ghi cuộc gọi được mã hóa phía máy khách trước khi rời khỏi trình duyệt. Máy chủ chỉ lưu trữ văn bản mã hóa.' },
        { icon: '\u{1F4DE}', title: 'Đổ chuông song song', description: 'Cuộc gọi đến đổ chuông đồng thời cho tất cả tình nguyện viên đang trực. Người đầu tiên trả lời sẽ nhận cuộc gọi.' },
        { icon: '\u{1F30D}', title: 'Hơn 12 ngôn ngữ tích hợp', description: 'Bản dịch giao diện đầy đủ cho tiếng Anh, Tây Ban Nha, Trung Quốc, Tagalog, Việt Nam, Ả Rập, Pháp, Creole Haiti, Hàn Quốc, Nga, Hindi và Bồ Đào Nha.' },
        { icon: '\u{1F399}', title: 'Phiên âm AI', description: 'Phiên âm cuộc gọi bằng Whisper với mã hóa đầu cuối. Quản trị viên và tình nguyện viên có thể bật/tắt độc lập.' },
        { icon: '\u{1F6E1}', title: 'Chống spam', description: 'CAPTCHA giọng nói, giới hạn tốc độ và danh sách cấm thời gian thực. Quản trị viên bật/tắt bảo vệ mà không cần khởi động lại.' },
        { icon: '\u{1F4F1}', title: 'PWA ưu tiên di động', description: 'Hoạt động trên mọi thiết bị. Có thể cài đặt như ứng dụng. Thông báo đẩy cho cuộc gọi đến.' },
      ],
    },
    security: {
      heading: 'Trung thực về bảo mật',
      description: 'Chúng tôi công bố chính xác những gì được mã hóa, những gì không và những gì máy chủ có thể thấy. Không mập mờ. Cuộc gọi thoại vẫn đi qua hạ tầng nhà cung cấp điện thoại của bạn (trừ khi bạn tự lưu trữ với Asterisk), và chúng tôi nói rõ điều này.',
      link: 'Đọc mô hình bảo mật',
    },
    deploy: {
      heading: 'Sẵn sàng triển khai?',
      description: 'Llámenos chạy trên Cloudflare Workers không cần quản lý hạ tầng. Khởi chạy đường dây nóng trong chưa đầy một giờ.',
      cta: 'Bắt đầu',
      github: 'Xem trên GitHub',
    },
  },
  ar: {
    hero: {
      badge: 'مفتوح المصدر \u00b7 تشفير من طرف إلى طرف',
      title: 'خط ساخن آمن للأزمات',
      titleAccent: 'للأشخاص الذين يحتاجونه',
      description: 'Llámenos هو برنامج خط ساخن مفتوح المصدر يحمي المتصلين والمتطوعين. ملاحظات مشفرة، وتوجيه مكالمات في الوقت الفعلي، وبنية معرفة صفرية \u2014 لتبقى المحادثات الحساسة خاصة.',
      cta: 'ابدأ الآن',
      ctaSecondary: 'اقرأ نموذج الأمان',
    },
    features: {
      heading: 'مصمم للاستجابة للأزمات',
      subtitle: 'كل ما يحتاجه خط ساخن \u2014 توجيه المكالمات، وتدوين الملاحظات المشفرة، وإدارة المناوبات، وأدوات الإدارة \u2014 في حزمة واحدة مفتوحة المصدر.',
      items: [
        { icon: '\u{1F512}', title: 'ملاحظات مشفرة من طرف إلى طرف', description: 'يتم تشفير ملاحظات المكالمات والنسخ في المتصفح قبل مغادرة الجهاز. يخزن الخادم النص المشفر فقط.' },
        { icon: '\u{1F4DE}', title: 'رنين متوازي', description: 'المكالمات الواردة ترن لجميع المتطوعين في المناوبة في وقت واحد. أول من يرد يحصل على المكالمة.' },
        { icon: '\u{1F30D}', title: 'أكثر من 12 لغة مدمجة', description: 'ترجمات كاملة للواجهة بالإنجليزية والإسبانية والصينية والتاغالوغية والفيتنامية والعربية والفرنسية والكريولية الهايتية والكورية والروسية والهندية والبرتغالية.' },
        { icon: '\u{1F399}', title: 'نسخ بالذكاء الاصطناعي', description: 'نسخ المكالمات بتقنية Whisper مع تشفير من طرف إلى طرف. يمكن للمسؤول والمتطوع التبديل بشكل مستقل.' },
        { icon: '\u{1F6E1}', title: 'مكافحة البريد المزعج', description: 'CAPTCHA صوتي، وتحديد المعدل، وقوائم حظر فورية. يمكن للمسؤولين تبديل الحماية دون إعادة التشغيل.' },
        { icon: '\u{1F4F1}', title: 'PWA للجوال أولاً', description: 'يعمل على أي جهاز. قابل للتثبيت كتطبيق. إشعارات فورية للمكالمات الواردة.' },
      ],
    },
    security: {
      heading: 'صادقون بشأن الأمان',
      description: 'ننشر بالضبط ما هو مشفر وما ليس كذلك وما يمكن للخادم رؤيته. بلا غموض. المكالمات الصوتية لا تزال تمر عبر البنية التحتية لمزود الهاتف الخاص بك (ما لم تستضيف ذاتياً باستخدام Asterisk)، ونقول ذلك صراحة.',
      link: 'اقرأ نموذج الأمان',
    },
    deploy: {
      heading: 'مستعد للنشر؟',
      description: 'يعمل Llámenos على Cloudflare Workers بدون بنية تحتية لإدارتها. شغّل خطاً ساخناً في أقل من ساعة.',
      cta: 'ابدأ الآن',
      github: 'عرض على GitHub',
    },
  },
  fr: {
    hero: {
      badge: 'Open source \u00b7 Chiffrement de bout en bout',
      title: "Ligne d'urgence sécurisée",
      titleAccent: 'pour ceux qui en ont besoin',
      description: "Llámenos est un logiciel de ligne d'assistance open source qui protège les appelants et les bénévoles. Notes chiffrées, routage d'appels en temps réel et architecture zéro connaissance \u2014 pour que les conversations sensibles restent privées.",
      cta: 'Commencer',
      ctaSecondary: 'Lire le modèle de sécurité',
    },
    features: {
      heading: "Conçu pour la réponse aux crises",
      subtitle: "Tout ce dont une ligne d'assistance a besoin \u2014 routage d'appels, notes chiffrées, gestion des équipes et outils d'administration \u2014 dans un seul logiciel open source.",
      items: [
        { icon: '\u{1F512}', title: 'Notes chiffrées de bout en bout', description: "Les notes et transcriptions sont chiffrées côté client avant de quitter le navigateur. Le serveur ne stocke que du texte chiffré." },
        { icon: '\u{1F4DE}', title: 'Sonnerie parallèle', description: "Les appels entrants sonnent simultanément chez tous les bénévoles en service. Le premier à décrocher obtient l'appel." },
        { icon: '\u{1F30D}', title: 'Plus de 12 langues intégrées', description: "Traductions complètes de l'interface : anglais, espagnol, chinois, tagalog, vietnamien, arabe, français, créole haïtien, coréen, russe, hindi et portugais." },
        { icon: '\u{1F399}', title: 'Transcription IA', description: "Transcription d'appels par Whisper avec chiffrement de bout en bout. L'administrateur et le bénévole peuvent activer/désactiver indépendamment." },
        { icon: '\u{1F6E1}', title: 'Protection anti-spam', description: "CAPTCHA vocal, limitation de débit et listes de blocage en temps réel. Les administrateurs activent les protections sans redémarrage." },
        { icon: '\u{1F4F1}', title: 'PWA mobile first', description: "Fonctionne sur tout appareil. Installable comme application. Notifications push pour les appels entrants." },
      ],
    },
    security: {
      heading: 'Honnêtes sur la sécurité',
      description: "Nous publions exactement ce qui est chiffré, ce qui ne l'est pas et ce que le serveur peut voir. Sans ambiguïté. Les appels vocaux passent toujours par l'infrastructure de votre fournisseur de téléphonie (sauf si vous hébergez vous-même avec Asterisk), et nous le disons clairement.",
      link: 'Lire le modèle de sécurité',
    },
    deploy: {
      heading: 'Prêt à déployer ?',
      description: "Llámenos fonctionne sur Cloudflare Workers sans infrastructure à gérer. Lancez une ligne d'assistance en moins d'une heure.",
      cta: 'Commencer',
      github: 'Voir sur GitHub',
    },
  },
  ht: {
    hero: {
      badge: 'Open source \u00b7 Chifre bout-an-bout',
      title: 'Liy kriz ki an sekirite',
      titleAccent: 'pou moun ki bezwen li',
      description: 'Llámenos se yon lojisyèl liy asistans open source ki pwoteje moun ki rele ak volontè yo. Nòt chifre, direksyon apèl an tan reyèl, ak achitekti zewo konesans \u2014 pou konvèsasyon sansib yo rete prive.',
      cta: 'Kòmanse',
      ctaSecondary: 'Li modèl sekirite a',
    },
    features: {
      heading: 'Fèt pou repons a kriz',
      subtitle: 'Tout sa yon liy asistans bezwen \u2014 direksyon apèl, nòt chifre, jesyon ekip, ak zouti admin \u2014 nan yon sèl pakè open source.',
      items: [
        { icon: '\u{1F512}', title: 'Nòt chifre bout-an-bout', description: 'Nòt apèl ak transkripsyon yo chifre nan navigatè a anvan yo kite aparèy la. Sèvè a sèlman estoke tèks chifre.' },
        { icon: '\u{1F4DE}', title: 'Sonri paralèl', description: 'Apèl ki rantre yo sonnen pou tout volontè ki sou ekip la an menm tan. Premye ki reponn nan pran apèl la.' },
        { icon: '\u{1F30D}', title: '12+ lang entegre', description: 'Tradiksyon konplè pou Angle, Panyòl, Chinwa, Tagalog, Vyetnamyen, Arab, Fransè, Kreyòl Ayisyen, Koreyen, Ris, Hindi, ak Pòtigè.' },
        { icon: '\u{1F399}', title: 'Transkripsyon IA', description: 'Transkripsyon apèl ak Whisper ki gen chifraj bout-an-bout. Admin ak volontè ka aktive/dezaktive endepandaman.' },
        { icon: '\u{1F6E1}', title: 'Pwoteksyon kont spam', description: 'CAPTCHA vwa, limit vitès, ak lis entèdiksyon an tan reyèl. Admin yo ka aktive pwoteksyon san redemaraj.' },
        { icon: '\u{1F4F1}', title: 'PWA mobil dabò', description: 'Mache sou nenpòt aparèy. Ka enstale tankou aplikasyon. Notifikasyon push pou apèl ki rantre.' },
      ],
    },
    security: {
      heading: 'Onèt sou sekirite',
      description: 'Nou pibliye egzakteman sa ki chifre, sa ki pa chifre, ak sa sèvè a ka wè. San dezòd. Apèl vwa yo toujou pase nan enfrastrikti founisè telefòn ou a (sof si ou fè self-host ak Asterisk), epi nou di sa klèman.',
      link: 'Li modèl sekirite a',
    },
    deploy: {
      heading: 'Pare pou deplwaye?',
      description: 'Llámenos fonksyone sou Cloudflare Workers san enfrastrikti pou jere. Lanse yon liy asistans nan mwens pase inèdtan.',
      cta: 'Kòmanse',
      github: 'Wè sou GitHub',
    },
  },
  ko: {
    hero: {
      badge: '오픈 소스 \u00b7 종단간 암호화',
      title: '안전한 위기 핫라인',
      titleAccent: '도움이 필요한 사람들을 위해',
      description: 'Llámenos는 발신자와 자원봉사자를 보호하는 오픈 소스 핫라인 소프트웨어입니다. 암호화된 메모, 실시간 통화 라우팅, 제로 지식 아키텍처 \u2014 민감한 대화를 비공개로 유지합니다.',
      cta: '시작하기',
      ctaSecondary: '보안 모델 읽기',
    },
    features: {
      heading: '위기 대응을 위해 구축',
      subtitle: '핫라인에 필요한 모든 것 \u2014 통화 라우팅, 암호화된 메모 작성, 교대 관리, 관리 도구 \u2014 하나의 오픈 소스 패키지로.',
      items: [
        { icon: '\u{1F512}', title: '종단간 암호화 메모', description: '통화 메모와 녹취록은 브라우저를 떠나기 전에 클라이언트 측에서 암호화됩니다. 서버는 암호문만 저장합니다.' },
        { icon: '\u{1F4DE}', title: '동시 벨 울림', description: '수신 전화가 근무 중인 모든 자원봉사자에게 동시에 울립니다. 먼저 받는 사람이 통화를 연결합니다.' },
        { icon: '\u{1F30D}', title: '12개 이상 언어 내장', description: '영어, 스페인어, 중국어, 타갈로그어, 베트남어, 아랍어, 프랑스어, 아이티 크리올어, 한국어, 러시아어, 힌디어, 포르투갈어 전체 UI 번역.' },
        { icon: '\u{1F399}', title: 'AI 녹취', description: 'Whisper 기반 통화 녹취, 종단간 암호화 포함. 관리자와 자원봉사자가 독립적으로 전환 가능.' },
        { icon: '\u{1F6E1}', title: '스팸 방지', description: '음성 CAPTCHA, 속도 제한, 실시간 차단 목록. 관리자가 재시작 없이 보호를 전환합니다.' },
        { icon: '\u{1F4F1}', title: '모바일 우선 PWA', description: '모든 기기에서 작동. 앱으로 설치 가능. 수신 전화 푸시 알림.' },
      ],
    },
    security: {
      heading: '보안에 대해 솔직하게',
      description: '무엇이 암호화되고, 무엇이 되지 않으며, 서버가 무엇을 볼 수 있는지 정확히 공개합니다. 모호함 없이. 음성 통화는 여전히 전화 서비스 제공업체의 인프라를 통과하며(Asterisk로 자체 호스팅하지 않는 한), 이를 솔직히 말합니다.',
      link: '보안 모델 읽기',
    },
    deploy: {
      heading: '배포할 준비가 되셨나요?',
      description: 'Llámenos는 Cloudflare Workers에서 관리할 인프라 없이 실행됩니다. 한 시간 이내에 핫라인을 가동하세요.',
      cta: '시작하기',
      github: 'GitHub에서 보기',
    },
  },
  ru: {
    hero: {
      badge: 'Открытый код \u00b7 Сквозное шифрование',
      title: 'Безопасная кризисная горячая линия',
      titleAccent: 'для тех, кому это нужно',
      description: 'Llámenos — это программное обеспечение горячей линии с открытым исходным кодом, защищающее звонящих и волонтёров. Зашифрованные заметки, маршрутизация вызовов в реальном времени и архитектура нулевого знания \u2014 чтобы конфиденциальные разговоры оставались приватными.',
      cta: 'Начать',
      ctaSecondary: 'Прочитать модель безопасности',
    },
    features: {
      heading: 'Создано для реагирования на кризисы',
      subtitle: 'Всё, что нужно горячей линии \u2014 маршрутизация вызовов, зашифрованные заметки, управление сменами и инструменты администрирования \u2014 в одном пакете с открытым кодом.',
      items: [
        { icon: '\u{1F512}', title: 'Заметки со сквозным шифрованием', description: 'Заметки и расшифровки звонков шифруются на стороне клиента до выхода из браузера. Сервер хранит только зашифрованный текст.' },
        { icon: '\u{1F4DE}', title: 'Параллельный вызов', description: 'Входящие звонки одновременно звонят всем волонтёрам на смене. Первый ответивший получает вызов.' },
        { icon: '\u{1F30D}', title: 'Более 12 встроенных языков', description: 'Полные переводы интерфейса: английский, испанский, китайский, тагальский, вьетнамский, арабский, французский, гаитянский креольский, корейский, русский, хинди и португальский.' },
        { icon: '\u{1F399}', title: 'ИИ-транскрипция', description: 'Транскрипция звонков на базе Whisper со сквозным шифрованием. Администратор и волонтёр могут переключать независимо.' },
        { icon: '\u{1F6E1}', title: 'Защита от спама', description: 'Голосовая CAPTCHA, ограничение частоты и списки блокировки в реальном времени. Администраторы переключают защиту без перезапуска.' },
        { icon: '\u{1F4F1}', title: 'PWA с приоритетом мобильных', description: 'Работает на любом устройстве. Устанавливается как приложение. Push-уведомления о входящих звонках.' },
      ],
    },
    security: {
      heading: 'Честно о безопасности',
      description: 'Мы публикуем точно, что зашифровано, что нет, и что видит сервер. Без двусмысленности. Голосовые звонки по-прежнему проходят через инфраструктуру вашего провайдера телефонии (если вы не используете Asterisk на своём сервере), и мы говорим об этом открыто.',
      link: 'Прочитать модель безопасности',
    },
    deploy: {
      heading: 'Готовы к развёртыванию?',
      description: 'Llámenos работает на Cloudflare Workers без необходимости управления инфраструктурой. Запустите горячую линию менее чем за час.',
      cta: 'Начать',
      github: 'Смотреть на GitHub',
    },
  },
  hi: {
    hero: {
      badge: 'ओपन सोर्स \u00b7 एंड-टू-एंड एन्क्रिप्टेड',
      title: 'सुरक्षित संकट हॉटलाइन',
      titleAccent: 'उन लोगों के लिए जिन्हें इसकी ज़रूरत है',
      description: 'Llámenos एक ओपन-सोर्स हॉटलाइन सॉफ़्टवेयर है जो कॉल करने वालों और स्वयंसेवकों की रक्षा करता है। एन्क्रिप्टेड नोट्स, रियल-टाइम कॉल रूटिंग, और ज़ीरो-नॉलेज आर्किटेक्चर \u2014 ताकि संवेदनशील बातचीत निजी बनी रहे।',
      cta: 'शुरू करें',
      ctaSecondary: 'सुरक्षा मॉडल पढ़ें',
    },
    features: {
      heading: 'संकट प्रतिक्रिया के लिए निर्मित',
      subtitle: 'एक हॉटलाइन को जो कुछ भी चाहिए \u2014 कॉल रूटिंग, एन्क्रिप्टेड नोट-टेकिंग, शिफ़्ट प्रबंधन, और एडमिन टूल्स \u2014 एक ओपन-सोर्स पैकेज में।',
      items: [
        { icon: '\u{1F512}', title: 'एंड-टू-एंड एन्क्रिप्टेड नोट्स', description: 'कॉल नोट्स और ट्रांसक्रिप्शन ब्राउज़र छोड़ने से पहले क्लाइंट-साइड पर एन्क्रिप्ट होते हैं। सर्वर केवल सिफरटेक्स्ट स्टोर करता है।' },
        { icon: '\u{1F4DE}', title: 'समानांतर रिंगिंग', description: 'आने वाली कॉल सभी ड्यूटी पर मौजूद स्वयंसेवकों को एक साथ रिंग करती है। पहले उठाने वाला कॉल प्राप्त करता है।' },
        { icon: '\u{1F30D}', title: '12+ भाषाएँ बिल्ट-इन', description: 'अंग्रेज़ी, स्पेनिश, चीनी, तागालोग, वियतनामी, अरबी, फ़्रेंच, हैतियन क्रियोल, कोरियाई, रूसी, हिंदी और पुर्तगाली के लिए पूर्ण UI अनुवाद।' },
        { icon: '\u{1F399}', title: 'AI ट्रांसक्रिप्शन', description: 'Whisper-संचालित कॉल ट्रांसक्रिप्शन, एंड-टू-एंड एन्क्रिप्शन के साथ। एडमिन और स्वयंसेवक स्वतंत्र रूप से टॉगल कर सकते हैं।' },
        { icon: '\u{1F6E1}', title: 'स्पैम सुरक्षा', description: 'वॉइस CAPTCHA, रेट लिमिटिंग, और रियल-टाइम बैन लिस्ट। एडमिन बिना रीस्टार्ट किए सुरक्षा टॉगल करते हैं।' },
        { icon: '\u{1F4F1}', title: 'मोबाइल-फ़र्स्ट PWA', description: 'किसी भी डिवाइस पर काम करता है। ऐप के रूप में इंस्टॉल करने योग्य। आने वाली कॉल के लिए पुश नोटिफ़िकेशन।' },
      ],
    },
    security: {
      heading: 'सुरक्षा के बारे में ईमानदार',
      description: 'हम सटीक रूप से प्रकाशित करते हैं कि क्या एन्क्रिप्टेड है, क्या नहीं है, और सर्वर क्या देख सकता है। बिना अस्पष्टता के। वॉइस कॉल अभी भी आपके टेलीफोनी प्रदाता के इंफ्रास्ट्रक्चर से गुज़रती हैं (जब तक आप Asterisk के साथ सेल्फ-होस्ट नहीं करते), और हम यह खुलकर कहते हैं।',
      link: 'सुरक्षा मॉडल पढ़ें',
    },
    deploy: {
      heading: 'तैनात करने के लिए तैयार?',
      description: 'Llámenos Cloudflare Workers पर बिना किसी इंफ्रास्ट्रक्चर प्रबंधन के चलता है। एक घंटे से कम में हॉटलाइन शुरू करें।',
      cta: 'शुरू करें',
      github: 'GitHub पर देखें',
    },
  },
  pt: {
    hero: {
      badge: 'Código aberto \u00b7 Criptografia de ponta a ponta',
      title: 'Linha de crise segura',
      titleAccent: 'para quem precisa',
      description: 'O Llámenos é um software de linha de ajuda de código aberto que protege quem liga e voluntários. Notas criptografadas, roteamento de chamadas em tempo real e arquitetura de conhecimento zero \u2014 para que conversas sensíveis permaneçam privadas.',
      cta: 'Começar',
      ctaSecondary: 'Ler o modelo de segurança',
    },
    features: {
      heading: 'Construído para resposta a crises',
      subtitle: 'Tudo que uma linha de ajuda precisa \u2014 roteamento de chamadas, notas criptografadas, gestão de turnos e ferramentas de administração \u2014 em um único pacote de código aberto.',
      items: [
        { icon: '\u{1F512}', title: 'Notas com criptografia de ponta a ponta', description: 'Notas de chamada e transcrições são criptografadas no navegador antes de sair do dispositivo. O servidor armazena apenas texto cifrado.' },
        { icon: '\u{1F4DE}', title: 'Toque paralelo', description: 'Chamadas recebidas tocam simultaneamente para todos os voluntários em turno. O primeiro a atender recebe a chamada.' },
        { icon: '\u{1F30D}', title: 'Mais de 12 idiomas integrados', description: 'Traduções completas da interface para inglês, espanhol, chinês, tagalo, vietnamita, árabe, francês, crioulo haitiano, coreano, russo, hindi e português.' },
        { icon: '\u{1F399}', title: 'Transcrição com IA', description: 'Transcrição de chamadas com Whisper e criptografia de ponta a ponta. Administrador e voluntário podem alternar independentemente.' },
        { icon: '\u{1F6E1}', title: 'Proteção contra spam', description: 'CAPTCHA de voz, limitação de taxa e listas de bloqueio em tempo real. Administradores alternam proteções sem reiniciar.' },
        { icon: '\u{1F4F1}', title: 'PWA mobile first', description: 'Funciona em qualquer dispositivo. Instalável como aplicativo. Notificações push para chamadas recebidas.' },
      ],
    },
    security: {
      heading: 'Honestos sobre segurança',
      description: 'Publicamos exatamente o que está criptografado, o que não está e o que o servidor pode ver. Sem ambiguidade. Chamadas de voz ainda passam pela infraestrutura do seu provedor de telefonia (a menos que você hospede com Asterisk), e dizemos isso abertamente.',
      link: 'Ler o modelo de segurança',
    },
    deploy: {
      heading: 'Pronto para implantar?',
      description: 'O Llámenos roda no Cloudflare Workers sem infraestrutura para gerenciar. Coloque uma linha de ajuda em funcionamento em menos de uma hora.',
      cta: 'Começar',
      github: 'Ver no GitHub',
    },
  },
  de: {
    hero: {
      badge: 'Open Source \u00b7 Ende-zu-Ende-verschlüsselt',
      title: 'Sichere Krisenhotline',
      titleAccent: 'für die Menschen, die sie brauchen',
      description: 'Llámenos ist eine Open-Source-Hotline-Software, die Anrufer und Freiwillige schützt. Verschlüsselte Notizen, Echtzeit-Anrufweiterleitung und eine Zero-Knowledge-Architektur \u2014 damit sensible Gespräche privat bleiben.',
      cta: 'Erste Schritte',
      ctaSecondary: 'Sicherheitsmodell lesen',
    },
    features: {
      heading: 'Für Krisenreaktion entwickelt',
      subtitle: 'Alles, was eine Hotline braucht \u2014 Anrufweiterleitung, verschlüsselte Notizen, Schichtmanagement und Admin-Tools \u2014 in einem einzigen Open-Source-Paket.',
      items: [
        { icon: '\u{1F512}', title: 'Ende-zu-Ende-verschlüsselte Notizen', description: 'Anrufnotizen und Transkriptionen werden clientseitig verschlüsselt, bevor sie den Browser verlassen. Der Server speichert nur Chiffretext.' },
        { icon: '\u{1F4DE}', title: 'Paralleles Klingeln', description: 'Eingehende Anrufe klingeln gleichzeitig bei allen diensthabenden Freiwilligen. Wer zuerst abnimmt, erhält den Anruf.' },
        { icon: '\u{1F30D}', title: 'Über 12 integrierte Sprachen', description: 'Vollständige UI-Übersetzungen für Englisch, Spanisch, Chinesisch, Tagalog, Vietnamesisch, Arabisch, Französisch, Haitianisches Kreol, Koreanisch, Russisch, Hindi und Portugiesisch.' },
        { icon: '\u{1F399}', title: 'KI-Transkription', description: 'Whisper-basierte Anruftranskription mit Ende-zu-Ende-Verschlüsselung. Administrator und Freiwillige können unabhängig umschalten.' },
        { icon: '\u{1F6E1}', title: 'Spam-Schutz', description: 'Sprach-CAPTCHA, Ratenbegrenzung und Echtzeit-Sperrlisten. Administratoren schalten Schutzmaßnahmen ohne Neustart um.' },
        { icon: '\u{1F4F1}', title: 'Mobile-first PWA', description: 'Funktioniert auf jedem Gerät. Als App installierbar. Push-Benachrichtigungen für eingehende Anrufe.' },
      ],
    },
    security: {
      heading: 'Ehrlich über Sicherheit',
      description: 'Wir veröffentlichen genau, was verschlüsselt ist, was nicht und was der Server sehen kann. Ohne Verschleierung. Sprachanrufe laufen weiterhin über die Infrastruktur Ihres Telefonieanbieter (es sei denn, Sie hosten selbst mit Asterisk), und das sagen wir offen.',
      link: 'Sicherheitsmodell lesen',
    },
    deploy: {
      heading: 'Bereit zur Bereitstellung?',
      description: 'Llámenos läuft auf Cloudflare Workers ohne zu verwaltende Infrastruktur. Starten Sie eine Hotline in weniger als einer Stunde.',
      cta: 'Erste Schritte',
      github: 'Auf GitHub ansehen',
    },
  },
};
