import { Category, Question } from './types';

export const INITIAL_CATEGORIES: Category[] = [
  {
    id: '1',
    name: 'Tarih',
    iconName: 'History',
    description: 'İslamiyet Öncesi, Osmanlı ve İnkılap Tarihi',
    subCategories: [
      { id: 't1', name: 'İslamiyet Öncesi Türk Tarihi' },
      { id: 't2', name: 'İlk Türk İslam Devletleri' },
      { id: 't3', name: 'Osmanlı Devleti Kuruluş ve Yükselme' },
      { id: 't4', name: 'Kurtuluş Savaşı Hazırlık Dönemi' },
    ]
  },
  {
    id: '2',
    name: 'Coğrafya',
    iconName: 'Map',
    description: 'Türkiye\'nin Fiziki ve Beşeri Coğrafyası',
    subCategories: [
      { id: 'c1', name: 'Türkiye\'nin Yer Şekilleri' },
      { id: 'c2', name: 'Türkiye\'de İklim ve Bitki Örtüsü' },
      { id: 'c3', name: 'Türkiye\'de Nüfus ve Yerleşme' },
    ]
  },
  {
    id: '3',
    name: 'Vatandaşlık',
    iconName: 'Scale',
    description: 'Temel Hukuk, Anayasa ve İdare',
    subCategories: [
      { id: 'v1', name: 'Temel Hukuk Kavramları' },
      { id: 'v2', name: '1982 Anayasası' },
      { id: 'v3', name: 'İdare Hukuku' },
    ]
  },
  {
    id: '4',
    name: 'Genel Kültür',
    iconName: 'Globe',
    description: 'Güncel Bilgiler ve Genel Kültür',
    subCategories: [
      { id: 'g1', name: 'Uluslararası Kuruluşlar' },
      { id: 'g2', name: 'Güncel Olaylar' },
      { id: 'g3', name: 'Türkiye Ekonomisi' },
    ]
  }
];

export const INITIAL_QUESTIONS: Record<string, Question[]> = {
  // Tarih - İslamiyet Öncesi (t1)
  't1': [
    {
      id: 'q1',
      questionText: 'Aşağıdakilerden hangisi İslamiyet öncesi Türk devletlerinde devlet işlerinin görüşülüp karara bağlandığı meclistir?',
      options: ['A) Toy', 'B) Pankuş', 'C) Senato', 'D) Divan', 'E) Lonca'],
      correctOptionIndex: 0,
      explanation: 'İslamiyet öncesi Türk devletlerinde devlet işlerinin görüşüldüğü meclise Toy (Kurultay) denirdi.'
    },
    {
      id: 'q2',
      contentItems: ['I. Mete Han', 'II. Teoman', 'III. Attila'],
      questionText: 'Yukarıdaki hükümdarlardan hangileri Asya Hun Devleti\'ne hükümdarlık yapmıştır?',
      options: ['A) Yalnız I', 'B) Yalnız II', 'C) I ve II', 'D) II ve III', 'E) I, II ve III'],
      correctOptionIndex: 2,
      explanation: 'Teoman Asya Hun Devleti\'nin kurucusu, Mete Han ise en parlak dönemini yaşatan hükümdardır. Attila Avrupa Hun hükümdarıdır.'
    },
    {
      id: 'q3',
      questionText: 'Türk adının anlamı Çin kaynaklarında aşağıdakilerden hangisi olarak geçmektedir?',
      options: ['A) Güçlü, Kuvvetli', 'B) Miğfer', 'C) Türeyen', 'D) Olgunluk Çağı', 'E) Kanun Nizam Sahibi'],
      correctOptionIndex: 1,
      explanation: 'Türk adı Çin kaynaklarında "Miğfer" olarak geçmektedir. Ziya Gökalp\'e göre ise "Kanun Nizam Sahibi" demektir.'
    },
    {
      id: 'q4',
      questionText: 'Kavimler Göçü sonucunda bugünkü Avrupa devletlerinin temelleri atılmıştır. Aşağıdakilerden hangisi bu devletlerden biri değildir?',
      options: ['A) İspanya', 'B) İngiltere', 'C) Fransa', 'D) ABD', 'E) Almanya'],
      correctOptionIndex: 3,
      explanation: 'ABD çok daha yakın bir tarihte (Yeni Çağ sonrası) kurulmuştur. Diğerleri Kavimler Göçü sonrası temelleri atılan Avrupa devletleridir.'
    }
  ],
  // Tarih - İlk Türk İslam (t2)
  't2': [
    {
      id: 'q5',
      questionText: 'Türk-İslam tarihinde "Muallim-i Sani" (İkinci Öğretmen) olarak bilinen ünlü düşünür kimdir?',
      options: ['A) İbni Sina', 'B) Farabi', 'C) Gazali', 'D) Biruni', 'E) Harezmi'],
      correctOptionIndex: 1,
      explanation: 'Aristo\'dan sonra ikinci öğretmen anlamına gelen Muallim-i Sani unvanı Farabi\'ye aittir.'
    }
  ],
  // Coğrafya - Yer Şekilleri (c1)
  'c1': [
    {
      id: 'q6',
      questionText: 'Türkiye\'de aşağıdaki kıyı tiplerinden hangisi görülmez?',
      options: ['A) Enine Kıyı', 'B) Boyuna Kıyı', 'C) Rias', 'D) Fiyort', 'E) Dalmaçya'],
      correctOptionIndex: 3,
      explanation: 'Türkiye matematik konumu (orta kuşak) gereği buzulların etkisiyle oluşan Fiyort tipi kıyılara sahip değildir.'
    },
    {
      id: 'q7',
      questionText: 'Türkiye\'nin en yüksek zirvesi olan Ağrı Dağı oluşum bakımından ne tür bir dağdır?',
      options: ['A) Kıvrım Dağı', 'B) Kırık Dağı', 'C) Volkanik Dağ', 'D) Buzul Dağı', 'E) Karstik Dağ'],
      correctOptionIndex: 2,
      explanation: 'Ağrı Dağı sönmüş bir volkanik dağdır.'
    },
    {
      id: 'q8',
      contentItems: ['I. Çarşamba', 'II. Bafra', 'III. Silifke'],
      questionText: 'Yukarıdaki ovaların ortak özelliği nedir?',
      options: ['A) Tektonik ova olmaları', 'B) Delta ovası olmaları', 'C) Karstik ova olmaları', 'D) İç Anadolu\'da bulunmaları', 'E) Volkanik kökenli olmaları'],
      correctOptionIndex: 1,
      explanation: 'Çarşamba (Yeşilırmak), Bafra (Kızılırmak) ve Silifke (Göksu) nehirlerin taşıdığı alüvyonlarla oluşan Delta ovalarıdır.'
    }
  ],
  // Coğrafya - İklim (c2)
  'c2': [
    {
      id: 'q9',
      questionText: 'Türkiye\'de en fazla yağış alan bölge ile en az yağış alan bölge hangisinde doğru verilmiştir?',
      options: ['A) Karadeniz - İç Anadolu', 'B) Ege - Güneydoğu Anadolu', 'C) Akdeniz - Doğu Anadolu', 'D) Karadeniz - Güneydoğu Anadolu', 'E) Marmara - İç Anadolu'],
      correctOptionIndex: 0,
      explanation: 'En fazla yağış Karadeniz (özellikle Doğu Karadeniz), en az yağış ise İç Anadolu (özellikle Tuz Gölü çevresi) bölgesine düşer.'
    }
  ],
  // Vatandaşlık - Temel Hukuk (v1)
  'v1': [
    {
      id: 'q10',
      questionText: 'Bir ülkede yetkili makamlar tarafından konulan yazılı hukuk kurallarının tümüne ne ad verilir?',
      options: ['A) Pozitif Hukuk', 'B) Mevzu Hukuk', 'C) Tabii Hukuk', 'D) Tarihi Hukuk', 'E) İdeal Hukuk'],
      correctOptionIndex: 1,
      explanation: 'Yetkili makamlarca konulan YAZILI kuralların tümüne Mevzu Hukuk (Mevzuat) denir. Yazılı+Yazısız hepsi olsaydı Pozitif Hukuk olurdu.'
    },
    {
      id: 'q11',
      questionText: 'Aşağıdakilerden hangisi ehliyet türlerinden biri değildir?',
      options: ['A) Tam ehliyetliler', 'B) Sınırlı ehliyetliler', 'C) Tam ehliyetsizler', 'D) Sınırlı ehliyetsizler', 'E) Yarı ehliyetliler'],
      correctOptionIndex: 4,
      explanation: 'Hukukumuzda "Yarı ehliyetliler" diye bir sınıflandırma yoktur.'
    }
  ],
  // Vatandaşlık - Anayasa (v2)
  'v2': [
    {
      id: 'q12',
      questionText: '1982 Anayasası\'na göre TBMM genel seçimleri kaç yılda bir yapılır?',
      options: ['A) 3', 'B) 4', 'C) 5', 'D) 6', 'E) 7'],
      correctOptionIndex: 2,
      explanation: '2017 Anayasa değişikliği ile TBMM seçimleri ve Cumhurbaşkanlığı seçimleri 5 yılda bir aynı gün yapılır.'
    },
    {
      id: 'q13',
      contentItems: ['I. Hatay', 'II. Kırıkkale', 'III. Batman'],
      questionText: 'Yukarıdaki illerden hangileri Cumhuriyet döneminde il statüsü kazanmıştır?',
      options: ['A) Yalnız I', 'B) I ve II', 'C) I ve III', 'D) II ve III', 'E) I, II ve III'],
      correctOptionIndex: 4,
      explanation: 'Verilen illerin hepsi Cumhuriyet döneminde il olmuştur. Hatay 1939\'da, Kırıkkale 1989\'da, Batman 1990\'da il olmuştur.'
    }
  ],
  // Genel Kültür (g1)
  'g1': [
    {
      id: 'q14',
      questionText: 'Birleşmiş Milletler (BM) Genel Merkezi hangi şehirdedir?',
      options: ['A) Cenevre', 'B) Paris', 'C) New York', 'D) Londra', 'E) Brüksel'],
      correctOptionIndex: 2,
      explanation: 'BM Genel Merkezi ABD\'nin New York şehrindedir.'
    },
    {
      id: 'q15',
      questionText: 'NATO\'ya en son katılan (2024 itibariyle) ülke aşağıdakilerden hangisidir?',
      options: ['A) Finlandiya', 'B) İsveç', 'C) Ukrayna', 'D) Norveç', 'E) Polonya'],
      correctOptionIndex: 1,
      explanation: 'İsveç, Macaristan\'ın onayıyla Mart 2024\'te NATO\'nun 32. üyesi olmuştur.'
    }
  ]
};

export const ICONS_MAP: Record<string, any> = {};