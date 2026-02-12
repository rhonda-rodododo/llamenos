export const common: Record<string, {
  nav: { features: string; security: string; docs: string; github: string };
  footer: {
    projectHeading: string;
    docsHeading: string;
    tagline: string;
    copyright: string;
    deployedOn: string;
    gettingStarted: string;
    adminGuide: string;
    volunteerGuide: string;
    securityModel: string;
  };
  docs: {
    sidebarTitle: string;
    overview: string;
    gettingStarted: string;
    adminGuide: string;
    volunteerGuide: string;
  };
  languageSwitcher: string;
}> = {
  en: {
    nav: { features: 'Features', security: 'Security', docs: 'Docs', github: 'GitHub' },
    footer: {
      projectHeading: 'Project',
      docsHeading: 'Documentation',
      tagline: 'Open-source secure crisis response hotline software. Built with end-to-end encryption by default.',
      copyright: 'Llámenos contributors. Open source under MIT license.',
      deployedOn: 'Deployed on',
      gettingStarted: 'Getting Started',
      adminGuide: 'Admin Guide',
      volunteerGuide: 'Volunteer Guide',
      securityModel: 'Security Model',
    },
    docs: {
      sidebarTitle: 'Documentation',
      overview: 'Overview',
      gettingStarted: 'Getting Started',
      adminGuide: 'Admin Guide',
      volunteerGuide: 'Volunteer Guide',
    },
    languageSwitcher: 'Language',
  },
  es: {
    nav: { features: 'Funciones', security: 'Seguridad', docs: 'Documentación', github: 'GitHub' },
    footer: {
      projectHeading: 'Proyecto',
      docsHeading: 'Documentación',
      tagline: 'Software de línea de crisis segura y de código abierto. Cifrado de extremo a extremo por defecto.',
      copyright: 'Colaboradores de Llámenos. Código abierto bajo licencia MIT.',
      deployedOn: 'Desplegado en',
      gettingStarted: 'Primeros pasos',
      adminGuide: 'Guía del administrador',
      volunteerGuide: 'Guía del voluntario',
      securityModel: 'Modelo de seguridad',
    },
    docs: {
      sidebarTitle: 'Documentación',
      overview: 'Descripción general',
      gettingStarted: 'Primeros pasos',
      adminGuide: 'Guía del administrador',
      volunteerGuide: 'Guía del voluntario',
    },
    languageSwitcher: 'Idioma',
  },
  zh: {
    nav: { features: '功能', security: '安全', docs: '文档', github: 'GitHub' },
    footer: {
      projectHeading: '项目',
      docsHeading: '文档',
      tagline: '开源安全危机响应热线软件。默认端到端加密。',
      copyright: 'Llámenos 贡献者。MIT 许可证开源。',
      deployedOn: '部署于',
      gettingStarted: '快速入门',
      adminGuide: '管理员指南',
      volunteerGuide: '志愿者指南',
      securityModel: '安全模型',
    },
    docs: {
      sidebarTitle: '文档',
      overview: '概述',
      gettingStarted: '快速入门',
      adminGuide: '管理员指南',
      volunteerGuide: '志愿者指南',
    },
    languageSwitcher: '语言',
  },
  tl: {
    nav: { features: 'Mga Tampok', security: 'Seguridad', docs: 'Dokumentasyon', github: 'GitHub' },
    footer: {
      projectHeading: 'Proyekto',
      docsHeading: 'Dokumentasyon',
      tagline: 'Open-source na secure na crisis response hotline software. May end-to-end encryption bilang default.',
      copyright: 'Mga kontribyutor ng Llámenos. Open source sa ilalim ng MIT license.',
      deployedOn: 'Naka-deploy sa',
      gettingStarted: 'Pagsisimula',
      adminGuide: 'Gabay ng Admin',
      volunteerGuide: 'Gabay ng Volunteer',
      securityModel: 'Modelo ng Seguridad',
    },
    docs: {
      sidebarTitle: 'Dokumentasyon',
      overview: 'Pangkalahatang-tanaw',
      gettingStarted: 'Pagsisimula',
      adminGuide: 'Gabay ng Admin',
      volunteerGuide: 'Gabay ng Volunteer',
    },
    languageSwitcher: 'Wika',
  },
  vi: {
    nav: { features: 'Tính năng', security: 'Bảo mật', docs: 'Tài liệu', github: 'GitHub' },
    footer: {
      projectHeading: 'Dự án',
      docsHeading: 'Tài liệu',
      tagline: 'Phần mềm đường dây nóng ứng phó khủng hoảng mã nguồn mở và bảo mật. Mã hóa đầu cuối theo mặc định.',
      copyright: 'Những người đóng góp Llámenos. Mã nguồn mở theo giấy phép MIT.',
      deployedOn: 'Triển khai trên',
      gettingStarted: 'Bắt đầu',
      adminGuide: 'Hướng dẫn quản trị',
      volunteerGuide: 'Hướng dẫn tình nguyện viên',
      securityModel: 'Mô hình bảo mật',
    },
    docs: {
      sidebarTitle: 'Tài liệu',
      overview: 'Tổng quan',
      gettingStarted: 'Bắt đầu',
      adminGuide: 'Hướng dẫn quản trị',
      volunteerGuide: 'Hướng dẫn tình nguyện viên',
    },
    languageSwitcher: 'Ngôn ngữ',
  },
  ar: {
    nav: { features: 'الميزات', security: 'الأمان', docs: 'التوثيق', github: 'GitHub' },
    footer: {
      projectHeading: 'المشروع',
      docsHeading: 'التوثيق',
      tagline: 'برنامج خط ساخن مفتوح المصدر وآمن للاستجابة للأزمات. تشفير من طرف إلى طرف افتراضيًا.',
      copyright: 'مساهمو Llámenos. مصدر مفتوح بموجب رخصة MIT.',
      deployedOn: 'منشور على',
      gettingStarted: 'البدء',
      adminGuide: 'دليل المسؤول',
      volunteerGuide: 'دليل المتطوع',
      securityModel: 'نموذج الأمان',
    },
    docs: {
      sidebarTitle: 'التوثيق',
      overview: 'نظرة عامة',
      gettingStarted: 'البدء',
      adminGuide: 'دليل المسؤول',
      volunteerGuide: 'دليل المتطوع',
    },
    languageSwitcher: 'اللغة',
  },
  fr: {
    nav: { features: 'Fonctionnalités', security: 'Sécurité', docs: 'Documentation', github: 'GitHub' },
    footer: {
      projectHeading: 'Projet',
      docsHeading: 'Documentation',
      tagline: "Logiciel de ligne d'urgence sécurisé et open source. Chiffrement de bout en bout par défaut.",
      copyright: 'Contributeurs de Llámenos. Open source sous licence MIT.',
      deployedOn: 'Déployé sur',
      gettingStarted: 'Premiers pas',
      adminGuide: "Guide de l'administrateur",
      volunteerGuide: 'Guide du bénévole',
      securityModel: 'Modèle de sécurité',
    },
    docs: {
      sidebarTitle: 'Documentation',
      overview: 'Aperçu',
      gettingStarted: 'Premiers pas',
      adminGuide: "Guide de l'administrateur",
      volunteerGuide: 'Guide du bénévole',
    },
    languageSwitcher: 'Langue',
  },
  ht: {
    nav: { features: 'Karakteristik', security: 'Sekirite', docs: 'Dokimantasyon', github: 'GitHub' },
    footer: {
      projectHeading: 'Pwojè',
      docsHeading: 'Dokimantasyon',
      tagline: 'Lojisyèl liy kriz ki an sekirite epi open source. Chifre bout-an-bout pa defo.',
      copyright: 'Kontribitè Llámenos. Open source anba lisans MIT.',
      deployedOn: 'Deplwaye sou',
      gettingStarted: 'Kòmanse',
      adminGuide: 'Gid Administratè',
      volunteerGuide: 'Gid Volontè',
      securityModel: 'Modèl Sekirite',
    },
    docs: {
      sidebarTitle: 'Dokimantasyon',
      overview: 'Apèsi',
      gettingStarted: 'Kòmanse',
      adminGuide: 'Gid Administratè',
      volunteerGuide: 'Gid Volontè',
    },
    languageSwitcher: 'Lang',
  },
  ko: {
    nav: { features: '기능', security: '보안', docs: '문서', github: 'GitHub' },
    footer: {
      projectHeading: '프로젝트',
      docsHeading: '문서',
      tagline: '오픈 소스 보안 위기 대응 핫라인 소프트웨어. 기본적으로 종단간 암호화.',
      copyright: 'Llámenos 기여자. MIT 라이선스 오픈 소스.',
      deployedOn: '배포 위치',
      gettingStarted: '시작하기',
      adminGuide: '관리자 가이드',
      volunteerGuide: '자원봉사자 가이드',
      securityModel: '보안 모델',
    },
    docs: {
      sidebarTitle: '문서',
      overview: '개요',
      gettingStarted: '시작하기',
      adminGuide: '관리자 가이드',
      volunteerGuide: '자원봉사자 가이드',
    },
    languageSwitcher: '언어',
  },
  ru: {
    nav: { features: 'Возможности', security: 'Безопасность', docs: 'Документация', github: 'GitHub' },
    footer: {
      projectHeading: 'Проект',
      docsHeading: 'Документация',
      tagline: 'Открытое безопасное программное обеспечение для кризисной горячей линии. Сквозное шифрование по умолчанию.',
      copyright: 'Участники Llámenos. Открытый исходный код по лицензии MIT.',
      deployedOn: 'Развёрнуто на',
      gettingStarted: 'Начало работы',
      adminGuide: 'Руководство администратора',
      volunteerGuide: 'Руководство волонтёра',
      securityModel: 'Модель безопасности',
    },
    docs: {
      sidebarTitle: 'Документация',
      overview: 'Обзор',
      gettingStarted: 'Начало работы',
      adminGuide: 'Руководство администратора',
      volunteerGuide: 'Руководство волонтёра',
    },
    languageSwitcher: 'Язык',
  },
  hi: {
    nav: { features: 'सुविधाएँ', security: 'सुरक्षा', docs: 'दस्तावेज़', github: 'GitHub' },
    footer: {
      projectHeading: 'परियोजना',
      docsHeading: 'दस्तावेज़',
      tagline: 'ओपन-सोर्स सुरक्षित संकट प्रतिक्रिया हॉटलाइन सॉफ़्टवेयर। डिफ़ॉल्ट रूप से एंड-टू-एंड एन्क्रिप्शन।',
      copyright: 'Llámenos योगदानकर्ता। MIT लाइसेंस के तहत ओपन सोर्स।',
      deployedOn: 'पर तैनात',
      gettingStarted: 'शुरू करें',
      adminGuide: 'प्रशासक गाइड',
      volunteerGuide: 'स्वयंसेवक गाइड',
      securityModel: 'सुरक्षा मॉडल',
    },
    docs: {
      sidebarTitle: 'दस्तावेज़',
      overview: 'अवलोकन',
      gettingStarted: 'शुरू करें',
      adminGuide: 'प्रशासक गाइड',
      volunteerGuide: 'स्वयंसेवक गाइड',
    },
    languageSwitcher: 'भाषा',
  },
  pt: {
    nav: { features: 'Recursos', security: 'Segurança', docs: 'Documentação', github: 'GitHub' },
    footer: {
      projectHeading: 'Projeto',
      docsHeading: 'Documentação',
      tagline: 'Software de linha de crise seguro e de código aberto. Criptografia de ponta a ponta por padrão.',
      copyright: 'Contribuidores do Llámenos. Código aberto sob licença MIT.',
      deployedOn: 'Implantado em',
      gettingStarted: 'Primeiros passos',
      adminGuide: 'Guia do administrador',
      volunteerGuide: 'Guia do voluntário',
      securityModel: 'Modelo de segurança',
    },
    docs: {
      sidebarTitle: 'Documentação',
      overview: 'Visão geral',
      gettingStarted: 'Primeiros passos',
      adminGuide: 'Guia do administrador',
      volunteerGuide: 'Guia do voluntário',
    },
    languageSwitcher: 'Idioma',
  },
  de: {
    nav: { features: 'Funktionen', security: 'Sicherheit', docs: 'Dokumentation', github: 'GitHub' },
    footer: {
      projectHeading: 'Projekt',
      docsHeading: 'Dokumentation',
      tagline: 'Open-Source-Software für sichere Krisenhotlines. Standardmäßig Ende-zu-Ende-verschlüsselt.',
      copyright: 'Llámenos-Mitwirkende. Open Source unter MIT-Lizenz.',
      deployedOn: 'Bereitgestellt auf',
      gettingStarted: 'Erste Schritte',
      adminGuide: 'Administratorhandbuch',
      volunteerGuide: 'Freiwilligenhandbuch',
      securityModel: 'Sicherheitsmodell',
    },
    docs: {
      sidebarTitle: 'Dokumentation',
      overview: 'Überblick',
      gettingStarted: 'Erste Schritte',
      adminGuide: 'Administratorhandbuch',
      volunteerGuide: 'Freiwilligenhandbuch',
    },
    languageSwitcher: 'Sprache',
  },
};
