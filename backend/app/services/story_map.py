from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import math
import random
import re
from datetime import datetime, timedelta, timezone
from heapq import heappop, heappush
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import StoryGame, StoryMapImage, StoryMemoryBlock, StoryMessage, User
from app.schemas import (
    StoryMapImageGenerateOut,
    StoryMapImageGenerateRequest,
    StoryMapImageOut,
    StoryMapLandmarkOut,
    StoryMapLocationOut,
    StoryMapPoiOut,
    StoryMapRegionOut,
    StoryMapRouteOut,
    StoryMapStateOut,
    StoryMapTravelModeOut,
    StoryMapTravelPreviewOut,
    StoryMapTravelLogEntryOut,
    StoryMapTravelRequest,
    StoryMapTravelStepOut,
    UserOut,
)
from app.services.auth_identity import get_current_user
from app.services.media import _load_pillow_modules
from app.services.story_games import (
    STORY_IMAGE_MODEL_FLUX,
    STORY_IMAGE_MODEL_SEEDREAM,
    coerce_story_image_model,
    deserialize_story_environment_datetime,
    deserialize_story_environment_weather,
    normalize_story_environment_enabled,
    serialize_story_environment_datetime,
)
from app.services.story_queries import get_user_story_game_or_404, touch_story_game
from app.services.concurrency import (
    add_user_tokens as _add_user_tokens_raw,
    spend_user_tokens_if_sufficient as _spend_user_tokens_if_sufficient_raw,
)

STORY_MAP_CANVAS_WIDTH = 1920
STORY_MAP_CANVAS_HEIGHT = 1280
STORY_MAP_MARGIN = 84
STORY_MAP_MAX_LOCATIONS = 72
STORY_MAP_MAX_LANDMARKS = 30
STORY_MAP_MAX_TRAVEL_LOG = 32
STORY_MAP_AI_REQUEST_MAX_TOKENS = 2_800
STORY_MAP_AI_TEXT_MODEL = "x-ai/grok-4.1-fast"

STORY_MAP_IMAGE_SCOPE_WORLD = "world"
STORY_MAP_IMAGE_SCOPE_EMPIRES = "empires"
STORY_MAP_IMAGE_SCOPE_REGION = "region"
STORY_MAP_IMAGE_SCOPE_LOCAL = "local"
STORY_MAP_IMAGE_SCOPE_SETTLEMENT = "settlement"
STORY_MAP_IMAGE_SCOPES = {
    STORY_MAP_IMAGE_SCOPE_WORLD,
    STORY_MAP_IMAGE_SCOPE_EMPIRES,
    STORY_MAP_IMAGE_SCOPE_REGION,
    STORY_MAP_IMAGE_SCOPE_LOCAL,
    STORY_MAP_IMAGE_SCOPE_SETTLEMENT,
}
STORY_MAP_IMAGE_ALLOWED_MODELS = {
    STORY_IMAGE_MODEL_FLUX,
    STORY_IMAGE_MODEL_SEEDREAM,
}
STORY_MAP_IMAGE_COST_BY_MODEL = {
    STORY_IMAGE_MODEL_FLUX: 6,
    STORY_IMAGE_MODEL_SEEDREAM: 9,
}
STORY_MAP_IMAGE_ACTIVE_LIMIT = 12

STORY_MAP_THEME_FANTASY = "fantasy"
STORY_MAP_THEME_CYBERPUNK = "cyberpunk"
STORY_MAP_THEME_STEAMPUNK = "steampunk"
STORY_MAP_THEME_POSTAPOC = "postapoc"
STORY_MAP_THEME_VALUES = {
    STORY_MAP_THEME_FANTASY,
    STORY_MAP_THEME_CYBERPUNK,
    STORY_MAP_THEME_STEAMPUNK,
    STORY_MAP_THEME_POSTAPOC,
}

STORY_MAP_OVERLAY_TERRAIN = "terrain"
STORY_MAP_OVERLAY_POLITICAL = "political"
STORY_MAP_VIEW_WORLD = "world"
STORY_MAP_VIEW_REGION = "region"
STORY_MAP_VIEW_LOCAL = "local"

logger = logging.getLogger(__name__)

STORY_MAP_KEYWORDS_BY_THEME: dict[str, tuple[str, ...]] = {
    STORY_MAP_THEME_CYBERPUNK: ("кибер", "cyber", "неон", "корпор", "мегапол", "имплант"),
    STORY_MAP_THEME_STEAMPUNK: ("стимпанк", "пар", "дирижаб", "латун", "steampunk"),
    STORY_MAP_THEME_POSTAPOC: ("постап", "руин", "пустош", "wasteland", "afterfall", "surviv"),
    STORY_MAP_THEME_FANTASY: ("фэнт", "маг", "корол", "импер", "эльф", "дракон", "fantasy"),
}

STORY_MAP_KIND_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("capital", "capital"),
    ("столиц", "capital"),
    ("metropolis", "city"),
    ("megacity", "city"),
    ("город", "city"),
    ("city", "city"),
    ("порт", "port"),
    ("port", "port"),
    ("деревн", "village"),
    ("village", "village"),
    ("town", "town"),
    ("посел", "town"),
    ("fort", "fort"),
    ("крепост", "fort"),
)

STORY_MAP_LOCATION_IMPORTANCE = {
    "capital": 100,
    "city": 84,
    "port": 78,
    "town": 62,
    "fort": 58,
    "village": 44,
}

STORY_MAP_ROUTE_KIND_LABELS_RU = {
    "road": "тракт",
    "trail": "тропа",
    "pass": "горный проход",
    "river": "речной путь",
    "maglev": "маглев-линия",
    "skyway": "скайвей",
    "service": "сервисная трасса",
    "rail": "паровая железная дорога",
    "canal": "канал",
    "causeway": "дамба",
}

STORY_MAP_LOCATION_KIND_LABELS_RU = {
    "capital": "столица",
    "city": "город",
    "port": "порт",
    "town": "поселение",
    "fort": "крепость",
    "village": "деревня",
}

STORY_MAP_SETTLEMENT_LOCATION_KINDS = {"capital", "city", "port", "town", "fort", "village"}

STORY_MAP_POI_COUNT_BY_LOCATION_KIND = {
    "capital": 16,
    "city": 14,
    "port": 14,
    "town": 10,
    "fort": 9,
    "village": 8,
}

STORY_MAP_POI_IMPORTANCE_BY_KIND = {
    "palace": 100,
    "keep": 96,
    "corp_tower": 96,
    "arcology_core": 96,
    "market": 88,
    "bazaar": 88,
    "barter_market": 88,
    "docks": 84,
    "airship_dock": 84,
    "transit_hub": 84,
    "station": 84,
    "tavern": 80,
    "bar": 80,
    "tea_house": 80,
    "smithy": 80,
    "workshop": 80,
    "foundry": 80,
    "clinic": 78,
    "temple": 76,
    "chapel": 76,
    "garden": 70,
    "park": 70,
    "farmstead": 62,
    "mill": 62,
    "watchtower": 72,
    "watchpost": 72,
    "gate": 74,
}

STORY_MAP_POI_KIND_LABELS_RU = {
    "academy": "академия",
    "airship_dock": "аэродок",
    "alchemist": "лавка алхимика",
    "arcology_core": "аркологое ядро",
    "armory": "оружейная",
    "bar": "бар",
    "barracks": "казармы",
    "barter_market": "рынок обмена",
    "bazaar": "базар",
    "bunker": "бункер",
    "canteen": "столовая",
    "chapel": "часовня",
    "clinic": "клиника",
    "clocktower": "часовая башня",
    "corp_tower": "корпоративная башня",
    "courtyard": "двор",
    "data_vault": "узел данных",
    "docks": "доки",
    "farmstead": "ферма",
    "foundry": "литейная",
    "garage": "мастерская",
    "garden": "сад",
    "gate": "ворота",
    "guildhall": "гильдия",
    "hall": "зал",
    "harbor": "гавань",
    "herbalist": "травница",
    "inn": "постоялый двор",
    "keep": "цитадель",
    "manor": "поместье",
    "market": "рынок",
    "mill": "мельница",
    "neon_plaza": "неоновая площадь",
    "observatory": "обсерватория",
    "palace": "дворец",
    "park": "парк",
    "plaza": "площадь",
    "salvage_yard": "свалка техники",
    "security_hq": "штаб охраны",
    "shrine": "святилище",
    "smithy": "кузня",
    "station": "вокзал",
    "tea_house": "чайный салон",
    "temple": "храм",
    "transit_hub": "транспортный узел",
    "tavern": "таверна",
    "water_tower": "водонапорная башня",
    "watchpost": "пост",
    "watchtower": "сторожевая башня",
    "workshop": "мастерская",
}

STORY_MAP_POI_SEARCH_TERMS_BY_KIND: dict[str, tuple[str, ...]] = {
    "academy": ("академия", "училище", "academy"),
    "airship_dock": ("аэродок", "дирижабль", "dock"),
    "alchemist": ("алхимик", "алхимическая лавка", "alchemy"),
    "arcology_core": ("аркология", "ядро", "arcology"),
    "armory": ("оружейная", "арсенал", "armory"),
    "bar": ("бар", "клуб", "bar"),
    "barracks": ("казармы", "гарнизон", "barracks"),
    "barter_market": ("рынок", "обмен", "market"),
    "bazaar": ("базар", "рынок", "bazaar"),
    "bunker": ("бункер", "убежище", "bunker"),
    "canteen": ("столовая", "харчевня", "canteen"),
    "chapel": ("часовня", "капелла", "chapel"),
    "clinic": ("клиника", "лазарет", "clinic"),
    "clocktower": ("часовая башня", "clocktower"),
    "corp_tower": ("корпоративная башня", "башня корпорации", "tower"),
    "courtyard": ("двор", "внутренний двор", "courtyard"),
    "data_vault": ("узел данных", "архив", "data"),
    "docks": ("доки", "пристань", "порт"),
    "farmstead": ("ферма", "хутор", "farm"),
    "foundry": ("литейная", "завод", "foundry"),
    "garage": ("гараж", "мастерская", "garage"),
    "garden": ("сад", "garden"),
    "gate": ("ворота", "gate"),
    "guildhall": ("гильдия", "hall"),
    "hall": ("зал", "hall"),
    "harbor": ("гавань", "порт", "harbor"),
    "herbalist": ("травница", "травник", "herbalist"),
    "inn": ("постоялый двор", "inn"),
    "keep": ("цитадель", "крепость", "keep"),
    "manor": ("поместье", "усадьба", "manor"),
    "market": ("рынок", "площадь", "market"),
    "mill": ("мельница", "mill"),
    "neon_plaza": ("площадь", "плаза", "plaza"),
    "observatory": ("обсерватория", "observatory"),
    "palace": ("дворец", "palace"),
    "park": ("парк", "сад", "park"),
    "plaza": ("площадь", "plaza"),
    "salvage_yard": ("свалка", "разборка", "yard"),
    "security_hq": ("штаб охраны", "security"),
    "shrine": ("святилище", "shrine"),
    "smithy": ("кузня", "кузнец", "smithy"),
    "station": ("станция", "вокзал", "station"),
    "tea_house": ("чайный салон", "чайная", "tea house"),
    "temple": ("храм", "temple"),
    "transit_hub": ("узел", "станция", "hub"),
    "tavern": ("таверна", "трактир", "tavern"),
    "water_tower": ("водонапорная башня", "башня воды", "water tower"),
    "watchpost": ("пост", "watchpost"),
    "watchtower": ("сторожевая башня", "watchtower"),
    "workshop": ("мастерская", "workshop"),
}

STORY_MAP_POI_TEMPLATES_BY_THEME: dict[str, dict[str, tuple[tuple[str, str, str], ...]]] = {
    STORY_MAP_THEME_FANTASY: {
        "core": (
            ("market", "Рыночная площадь", "Торговое сердце поселения с лавками, шумом и слухами."),
            ("tavern", "Таверна", "Шумная таверна, где сходятся путники, наемники и слухи."),
            ("smithy", "Кузня", "Кузня и мастерская ремесленников у оживленной улицы."),
            ("temple", "Святилище", "Каменный храм или святилище с тихим двором."),
            ("gate", "Главные ворота", "Основной въезд с караулом и потоком повозок."),
        ),
        "capital": (
            ("palace", "Дворец", "Дворец власти с парадным двором и внутренней охраной."),
            ("academy", "Академия", "Учёный или магический корпус с закрытыми галереями."),
            ("alchemist", "Лавка алхимика", "Алхимическая лавка с редкими реагентами и стеклянными витринами."),
            ("garden", "Королевский сад", "Террасный сад с прогулочными дорожками и статуями."),
            ("manor", "Родовое поместье", "Крупное дворянское поместье у престижной улицы."),
            ("guildhall", "Дом гильдии", "Гильдейский зал с казной, заказами и приемной."),
        ),
        "city": (
            ("guildhall", "Дом гильдии", "Городская гильдия ремесленников и торговцев."),
            ("alchemist", "Лавка алхимика", "Лавка зелий, порошков и редких трав."),
            ("park", "Городской сад", "Зеленый уголок с аллеями и фонтаном."),
            ("manor", "Усадьба знати", "Закрытое городское поместье с отдельным двором."),
        ),
        "port": (
            ("docks", "Пристани", "Пирсы, склады и лодочные причалы у воды."),
            ("harbor", "Гавань", "Внешняя гавань с башней сигнального огня."),
        ),
        "town": (
            ("inn", "Постоялый двор", "Постоялый двор у дороги с конюшней и общим залом."),
            ("mill", "Мельница", "Водяная или ветряная мельница на окраине."),
        ),
        "village": (
            ("herbalist", "Дом травницы", "Небольшая лавка травницы у тишайшей улицы."),
            ("farmstead", "Хутор", "Хозяйственный двор с амбарами и скотом."),
            ("mill", "Мельница", "Сельская мельница у ручья или на холме."),
            ("shrine", "Часовня", "Небольшое святилище у общинной площади."),
        ),
        "fort": (
            ("keep", "Цитадель", "Внутренний донжон и последний рубеж гарнизона."),
            ("barracks", "Казармы", "Казармы и плац гарнизона."),
            ("armory", "Арсенал", "Оружейный двор и склад снаряжения."),
            ("watchtower", "Сигнальная башня", "Высокая башня наблюдения над округой."),
        ),
    },
    STORY_MAP_THEME_CYBERPUNK: {
        "core": (
            ("bazaar", "Теневой базар", "Плотный рынок имплантов, запчастей и нелегальной электроники."),
            ("bar", "Ночной бар", "Неоновый бар с музыкой, посредниками и охраной у входа."),
            ("garage", "Техмастерская", "Гараж, где чинят байки, дроны и уличное железо."),
            ("clinic", "Клиника", "Подпольная клиника с операционными и очередью под навесом."),
            ("transit_hub", "Транзитный узел", "Пересадочный узел с платформами, лифтами и потоком людей."),
        ),
        "capital": (
            ("corp_tower", "Корпоративная башня", "Башня доминирующей корпорации над центральным сектором."),
            ("data_vault", "Архивный узел", "Закрытый дата-узел с серверами и силовой защитой."),
            ("neon_plaza", "Неоновая площадь", "Главная плаза с рекламой, сценами и потоками транспорта."),
            ("security_hq", "Штаб охраны", "Укрепленный штаб городской безопасности и дрон-патрулей."),
            ("park", "Небесный сад", "Искусственный парк на платформе над магистралями."),
        ),
        "city": (
            ("plaza", "Уличная плаза", "Пешеходная плаза с фуд-точками и уличными сеттерами."),
            ("corp_tower", "Офисная башня", "Высотный блок филиала или дочерней корпорации."),
            ("clinic", "Нейроклиника", "Клиника модификаций и быстрой диагностики."),
        ),
        "port": (
            ("docks", "Грузовые доки", "Контейнерные доки и крановые пути у канала."),
            ("harbor", "Портовый сектор", "Портовая кромка с складами и разгрузочными рампами."),
        ),
        "town": (
            ("canteen", "Кантинa", "Недорогая столовая и точка встреч дальнобоев."),
            ("watchpost", "Пост наблюдения", "Пост контроля въезда с прожекторами и шлагбаумами."),
        ),
        "village": (
            ("workshop", "Полевая мастерская", "Сборная мастерская на окраине поселка."),
            ("water_tower", "Водяная башня", "Критическая башня очистки и хранения воды."),
        ),
        "fort": (
            ("security_hq", "Опорный узел", "Укрепленный опорный пункт с сенсорами и турелями."),
            ("barracks", "Казарменный блок", "Жилой и боевой модуль гарнизона."),
            ("watchtower", "Смотровая мачта", "Высокая мачта дальнего наблюдения."),
        ),
    },
    STORY_MAP_THEME_STEAMPUNK: {
        "core": (
            ("market", "Медный рынок", "Крытый рынок с латунными павильонами и уличными механизмами."),
            ("tea_house", "Чайный салон", "Салон встреч инженеров, путешественников и городских слухов."),
            ("workshop", "Механическая мастерская", "Мастерская часовщиков и паровых ремесленников."),
            ("chapel", "Часовня", "Каменная часовня у тихого квартала."),
            ("station", "Вокзал", "Железнодорожная станция с платформой и дымом локомотивов."),
        ),
        "capital": (
            ("palace", "Дворец", "Парадный дворец с стеклянными галереями и медными куполами."),
            ("airship_dock", "Аэродок", "Причальная башня дирижаблей и парящих барж."),
            ("academy", "Инженерная академия", "Академия механикумов, навигаторов и картографов."),
            ("clocktower", "Часовая башня", "Высокая башня, задающая ритм всему центру."),
            ("garden", "Оранжерейный сад", "Стеклянные сады и прогулочные галереи."),
        ),
        "city": (
            ("foundry", "Литейная", "Большая литейная с кран-балками и печами."),
            ("observatory", "Обсерватория", "Купольная площадка наблюдений и навигации."),
            ("guildhall", "Дом цехов", "Представительство цехов и торговых союзов."),
        ),
        "port": (
            ("docks", "Речные доки", "Доки с крановыми фермами и грузовыми лебедками."),
            ("airship_dock", "Аэродок", "Высотный причал для дирижаблей и почтовых платформ."),
        ),
        "town": (
            ("inn", "Постоялый двор", "Постоялый двор и перевалочная станция у тракта."),
            ("mill", "Паровая мельница", "Мельничный корпус на паровом приводе."),
        ),
        "village": (
            ("farmstead", "Усадьба", "Хозяйственный двор с теплицами и паровыми насосами."),
            ("herbalist", "Аптекарская", "Аптекарская лавка с настоями и маслами."),
        ),
        "fort": (
            ("keep", "Комендантский блок", "Центральный укрепленный блок коменданта."),
            ("armory", "Арсенал", "Оружейная и склад боевых механизмов."),
            ("watchtower", "Башня сигнала", "Башня семафоров и дальних фонарей."),
        ),
    },
    STORY_MAP_THEME_POSTAPOC: {
        "core": (
            ("barter_market", "Обменный рынок", "Центральная площадка обмена водой, патронами и пайками."),
            ("canteen", "Общий навес", "Навес с едой, огнем и постоянным людским движением."),
            ("clinic", "Лазарет", "Полевой лазарет из контейнеров и собранных модулей."),
            ("watchpost", "Пост", "Пост дозора у въезда и внешней линии баррикад."),
            ("gate", "Баррикадные ворота", "Главные ворота, собранные из металлолома и старых створок."),
        ),
        "capital": (
            ("keep", "Центральный редут", "Крупнейший опорный редут, где держится власть."),
            ("water_tower", "Водяная башня", "Ключевой резервуар и самый охраняемый ресурс поселения."),
            ("salvage_yard", "Разборочный двор", "Главная площадка разбора техники и продажи деталей."),
            ("manor", "Штаб вожака", "Закрытый штаб местной верхушки или главы города."),
            ("park", "Старый парк", "Заросший парк с тропами, кострищами и укрытиями."),
        ),
        "city": (
            ("bunker", "Бункер", "Укрепленный блок убежищ и складов."),
            ("salvage_yard", "Свалка техники", "Широкий двор старых корпусов, шин и железа."),
            ("garage", "Ремдвор", "Место ремонта генераторов, багги и фильтров."),
        ),
        "port": (
            ("docks", "Сухие причалы", "Старые доки и бетонные рампы у воды."),
            ("harbor", "Кромка гавани", "Гавань выживших со сторожевыми лодками."),
        ),
        "town": (
            ("workshop", "Сборочная", "Сборочная мастерская из контейнеров и листового железа."),
            ("watchtower", "Башня дозора", "Надстройка наблюдения над дорогой и пустошами."),
        ),
        "village": (
            ("farmstead", "Грядки и двор", "Обнесенный сеткой двор с теплицами и запасами."),
            ("shrine", "Мемориал", "Небольшое место памяти и общих собраний."),
        ),
        "fort": (
            ("keep", "Узел обороны", "Укрепленный командный узел с тяжелыми воротами."),
            ("armory", "Оружейный склад", "Главный склад боеприпасов и брони."),
            ("watchtower", "Смотровая вышка", "Вышка наблюдения над трассой и пустошами."),
        ),
    },
}

STORY_MAP_REGION_KIND_LABELS_RU = {
    "empire": "империя",
    "march": "марка",
    "sector": "сектор",
    "corporate_zone": "корпоративная зона",
    "rail_union": "союз магистралей",
    "wasteland": "пустошь",
    "enclave": "анклав",
}

STORY_MAP_NAME_PARTS_BY_THEME: dict[str, dict[str, tuple[str, ...]]] = {
    STORY_MAP_THEME_FANTASY: {
        "region_prefix": ("Авр", "Северн", "Вал", "Сел", "Мир", "Эл"),
        "region_suffix": ("елион", "марк", "дарион", "вальд", "арис", "крон"),
        "city_prefix": ("Фран", "Ар", "Бел", "Кес", "Нор", "Рив"),
        "city_suffix": ("фурт", "доль", "мир", "град", "хейм", "бург"),
        "landmark_prefix": ("Дракон", "Шепчущ", "Серебрян", "Лунн", "Туманный"),
        "landmark_suffix": (" хребет", " лес", " перевал", " утес", " башня"),
    },
    STORY_MAP_THEME_CYBERPUNK: {
        "region_prefix": ("Нео", "Кван", "Вектор", "Сигма", "Нова"),
        "region_suffix": ("-Сектор", "-Лайн", "-Кластер", "-Пояс"),
        "city_prefix": ("Некс", "Арка", "Кобальт", "Синт", "Вольт"),
        "city_suffix": ("ус", "рон", "порт", "гейт", "хаб"),
        "landmark_prefix": ("Ржавый", "Лазерный", "Шумовой", "Пульсирующий"),
        "landmark_suffix": (" док", " шпиль", " реактор", " узел"),
    },
    STORY_MAP_THEME_STEAMPUNK: {
        "region_prefix": ("Брасс", "Паров", "Медн", "Аэро", "Шестерен"),
        "region_suffix": ("марх", "форд", "крон", "союз", "кварт"),
        "city_prefix": ("Коппер", "Эмбер", "Галт", "Ривет", "Вапор"),
        "city_suffix": ("тон", "хилл", "кросс", "порт", "фордж"),
        "landmark_prefix": ("Паровой", "Железный", "Медный", "Высотный"),
        "landmark_suffix": (" мост", " док", " шпиль", " котел"),
    },
    STORY_MAP_THEME_POSTAPOC: {
        "region_prefix": ("Пепел", "Сломанн", "Сух", "Ржав", "Пыльн"),
        "region_suffix": ("ые земли", "ый пояс", "ый разлом", "ая дуга"),
        "city_prefix": ("Хард", "Скар", "Ред", "Фол", "Даст"),
        "city_suffix": ("таун", "хоуп", "нокс", "ридж", "пост"),
        "landmark_prefix": ("Черный", "Обугленный", "Треснувший", "Голодный"),
        "landmark_suffix": (" каньон", " кратер", " остов", " мост"),
    },
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_text(value: str | None, *, max_length: int) -> str:
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip()[:max_length].strip()


def _normalize_multiline_text(value: str | None, *, max_length: int) -> str:
    normalized = str(value or "").replace("\r\n", "\n").strip()
    if len(normalized) > max_length:
        normalized = normalized[:max_length].rstrip()
    return normalized


def _spend_user_tokens_if_sufficient(db: Session, user_id: int, tokens: int) -> bool:
    return _spend_user_tokens_if_sufficient_raw(
        db,
        user_id=int(user_id),
        tokens=max(int(tokens), 0),
    )


def _add_user_tokens(db: Session, user_id: int, tokens: int) -> None:
    _add_user_tokens_raw(
        db,
        user_id=int(user_id),
        tokens=max(int(tokens), 0),
    )


def _extract_json_object_from_text(raw_value: str) -> dict[str, Any] | None:
    stripped = str(raw_value or "").strip()
    if not stripped:
        return None
    try:
        parsed = json.loads(stripped)
    except (TypeError, ValueError):
        parsed = None
    if isinstance(parsed, dict):
        return parsed
    match = re.search(r"\{[\s\S]*\}", stripped)
    if match is None:
        return None
    try:
        parsed = json.loads(match.group(0))
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _normalize_theme(raw_theme: str | None, *, world_description: str, start_location: str) -> str:
    normalized_theme = _normalize_text(raw_theme, max_length=32).lower()
    if normalized_theme in STORY_MAP_THEME_VALUES:
        return normalized_theme
    search_space = f"{world_description}\n{start_location}".casefold()
    best_theme = STORY_MAP_THEME_FANTASY
    best_score = -1
    for theme_id, keywords in STORY_MAP_KEYWORDS_BY_THEME.items():
        score = sum(1 for keyword in keywords if keyword in search_space)
        if score > best_score:
            best_score = score
            best_theme = theme_id
    return best_theme


def _seed_from_inputs(world_description: str, start_location: str, theme: str) -> str:
    raw_value = f"{theme}\n{world_description}\n{start_location}"
    return hashlib.sha256(raw_value.encode("utf-8")).hexdigest()[:16]


def _build_rng(seed: str) -> random.Random:
    return random.Random(int(seed, 16))


def _clamp_coordinate(value: float, *, upper_bound: int) -> float:
    return round(max(float(STORY_MAP_MARGIN), min(float(value), float(upper_bound - STORY_MAP_MARGIN))), 2)


def _point(x: float, y: float) -> dict[str, float]:
    return {
        "x": _clamp_coordinate(x, upper_bound=STORY_MAP_CANVAS_WIDTH),
        "y": _clamp_coordinate(y, upper_bound=STORY_MAP_CANVAS_HEIGHT),
    }


def _story_map_theme_travel_mode_catalog(theme: str) -> list[dict[str, Any]]:
    catalogs: dict[str, list[dict[str, Any]]] = {
        STORY_MAP_THEME_FANTASY: [
            {"id": "walk", "label": "Пешком", "description": "Медленно, но почти везде.", "speed_multiplier": 1.0},
            {"id": "horse", "label": "Верхом", "description": "Быстро на дорогах и трактах.", "speed_multiplier": 1.65},
            {"id": "carriage", "label": "В экипаже", "description": "Комфортнее на хороших дорогах.", "speed_multiplier": 1.35},
            {"id": "ship", "label": "Кораблем", "description": "Только по воде.", "speed_multiplier": 2.4},
        ],
        STORY_MAP_THEME_CYBERPUNK: [
            {"id": "walk", "label": "Пешком", "description": "Надежно, но не быстро.", "speed_multiplier": 1.0},
            {"id": "bike", "label": "На байке", "description": "Быстро на улицах и шоссе.", "speed_multiplier": 1.8},
            {"id": "car", "label": "На машине", "description": "Лучше всего по дорогам.", "speed_multiplier": 2.35},
            {"id": "maglev", "label": "По маглеву", "description": "Только по маглев-линиям.", "speed_multiplier": 4.8},
        ],
        STORY_MAP_THEME_STEAMPUNK: [
            {"id": "walk", "label": "Пешком", "description": "Базовый способ передвижения.", "speed_multiplier": 1.0},
            {"id": "horse", "label": "Верхом", "description": "Для трактов и проселков.", "speed_multiplier": 1.55},
            {"id": "carriage", "label": "В экипаже", "description": "Лучше по дорогам и дамбам.", "speed_multiplier": 1.4},
            {"id": "rail", "label": "По железной дороге", "description": "Только по рельсам.", "speed_multiplier": 3.1},
            {"id": "airship", "label": "На дирижабле", "description": "Только по небесным линиям.", "speed_multiplier": 3.8},
        ],
        STORY_MAP_THEME_POSTAPOC: [
            {"id": "walk", "label": "Пешком", "description": "Самый надежный способ.", "speed_multiplier": 1.0},
            {"id": "horse", "label": "Верхом", "description": "Для троп и разбитых дорог.", "speed_multiplier": 1.5},
            {"id": "buggy", "label": "На багги", "description": "Хорошо по сухим трассам.", "speed_multiplier": 2.0},
            {"id": "truck", "label": "На грузовике", "description": "Быстрее на сервисных дорогах.", "speed_multiplier": 2.15},
        ],
    }
    return [dict(item) for item in catalogs.get(theme, catalogs[STORY_MAP_THEME_FANTASY])]


def _pick_name(rng: random.Random, *, theme: str, bucket: str) -> str:
    parts = STORY_MAP_NAME_PARTS_BY_THEME.get(theme) or STORY_MAP_NAME_PARTS_BY_THEME[STORY_MAP_THEME_FANTASY]
    prefixes = parts.get(f"{bucket}_prefix") or ("Нова",)
    suffixes = parts.get(f"{bucket}_suffix") or ("холм",)
    return f"{prefixes[rng.randrange(len(prefixes))]}{suffixes[rng.randrange(len(suffixes))]}"


def _extract_explicit_place_name(raw_value: str) -> str:
    normalized_value = _normalize_text(raw_value, max_length=200)
    if not normalized_value:
        return ""
    explicit_name_matches = re.findall(
        r"[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'-]+(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'-]+)*",
        normalized_value,
    )
    if explicit_name_matches:
        return explicit_name_matches[-1].strip()
    after_comma = [part.strip() for part in normalized_value.split(",") if part.strip()]
    if after_comma:
        candidate = re.sub(
            r"^(?:город|деревня|столица|порт|town|city|capital)\s+",
            "",
            after_comma[-1],
            flags=re.IGNORECASE,
        )
        if candidate and len(candidate) >= 3:
            return candidate.strip()
    return ""


def _detect_location_kind(raw_value: str) -> str:
    lowered = str(raw_value or "").casefold()
    for keyword, kind in STORY_MAP_KIND_KEYWORDS:
        if keyword in lowered:
            return kind
    return "city"


def _location_display_name(*, kind: str, name: str) -> str:
    location_label = STORY_MAP_LOCATION_KIND_LABELS_RU.get(kind, "место")
    return f"{location_label.capitalize()} {name}".strip()


def _route_kind_for_theme(theme: str, *, intra_region: bool, rng: random.Random) -> str:
    if theme == STORY_MAP_THEME_CYBERPUNK:
        return ("service", "skyway", "maglev")[rng.randrange(3)] if intra_region else ("maglev", "skyway")[rng.randrange(2)]
    if theme == STORY_MAP_THEME_STEAMPUNK:
        return ("road", "rail", "canal")[rng.randrange(3)] if intra_region else ("rail", "canal")[rng.randrange(2)]
    if theme == STORY_MAP_THEME_POSTAPOC:
        return ("trail", "road", "causeway")[rng.randrange(3)] if intra_region else ("road", "trail")[rng.randrange(2)]
    return ("road", "trail", "river")[rng.randrange(3)] if intra_region else ("road", "pass")[rng.randrange(2)]


def _route_label_ru(kind: str) -> str:
    return STORY_MAP_ROUTE_KIND_LABELS_RU.get(kind, kind)


def _region_kind_for_theme(theme: str, index: int) -> str:
    if theme == STORY_MAP_THEME_CYBERPUNK:
        return "corporate_zone" if index == 0 else "sector"
    if theme == STORY_MAP_THEME_STEAMPUNK:
        return "rail_union" if index == 0 else "march"
    if theme == STORY_MAP_THEME_POSTAPOC:
        return "enclave" if index == 0 else "wasteland"
    return "empire" if index == 0 else "march"


def _region_blob_polygon(center_x: float, center_y: float, *, rng: random.Random, radius: float) -> list[dict[str, float]]:
    points: list[dict[str, float]] = []
    for step_index in range(9):
        angle = ((math.pi * 2) / 9) * step_index + rng.uniform(-0.18, 0.18)
        step_radius = radius * rng.uniform(0.82, 1.08)
        ellipse_y = step_radius * rng.uniform(0.8, 0.94)
        points.append(_point(center_x + math.cos(angle) * step_radius, center_y + math.sin(angle) * ellipse_y))
    return points


def _story_map_region_anchor_positions(region_count: int) -> list[tuple[float, float]]:
    if region_count >= 6:
        return [
            (0.18, 0.25),
            (0.49, 0.16),
            (0.81, 0.25),
            (0.79, 0.73),
            (0.5, 0.84),
            (0.2, 0.72),
        ][:region_count]
    return [
        (0.2, 0.24),
        (0.52, 0.15),
        (0.83, 0.34),
        (0.7, 0.8),
        (0.27, 0.78),
    ][:region_count]


def _story_map_frame_from_points(
    points: list[tuple[float, float]],
    *,
    canvas_width: float,
    canvas_height: float,
    padding: float,
    min_width: float,
    min_height: float,
) -> tuple[float, float, float, float] | None:
    if not points:
        return None
    min_x = min(point[0] for point in points) - padding
    min_y = min(point[1] for point in points) - padding
    max_x = max(point[0] for point in points) + padding
    max_y = max(point[1] for point in points) + padding
    width = min(max(max_x - min_x, min_width), canvas_width)
    height = min(max(max_y - min_y, min_height), canvas_height)
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    frame_x = min(max(center_x - width / 2, 0.0), max(canvas_width - width, 0.0))
    frame_y = min(max(center_y - height / 2, 0.0), max(canvas_height - height, 0.0))
    return (frame_x, frame_y, width, height)


def _story_map_distance(left_x: float, left_y: float, right_x: float, right_y: float) -> float:
    return math.hypot(float(right_x) - float(left_x), float(right_y) - float(left_y))


def _location_aliases(name: str, *, kind: str, exact_prompt: str | None = None) -> list[str]:
    aliases: list[str] = [name.strip(), _location_display_name(kind=kind, name=name)]
    if exact_prompt:
        aliases.append(_normalize_text(exact_prompt, max_length=160))
    return _dedupe_story_map_aliases(aliases)


def _dedupe_story_map_aliases(values: list[str]) -> list[str]:
    normalized_aliases: list[str] = []
    seen: set[str] = set()
    for alias in values:
        normalized_alias = " ".join(alias.split()).strip()
        normalized_key = normalized_alias.casefold()
        if not normalized_alias or normalized_key in seen:
            continue
        seen.add(normalized_key)
        normalized_aliases.append(normalized_alias)
    return normalized_aliases


def _story_map_location_supports_settlement(kind: str | None) -> bool:
    return str(kind or "").strip().lower() in STORY_MAP_SETTLEMENT_LOCATION_KINDS


def _poi_aliases(name: str, *, kind: str) -> list[str]:
    return _dedupe_story_map_aliases(
        [
            name.strip(),
            STORY_MAP_POI_KIND_LABELS_RU.get(kind, ""),
            *STORY_MAP_POI_SEARCH_TERMS_BY_KIND.get(kind, ()),
        ]
    )


def _make_location(
    *,
    index: int,
    name: str,
    kind: str,
    region_id: str,
    x: float,
    y: float,
    description: str,
    exact_prompt: str | None = None,
) -> dict[str, Any]:
    return {
        "id": f"loc-{index}",
        "name": name,
        "kind": kind,
        "region_id": region_id,
        "x": round(x, 2),
        "y": round(y, 2),
        "importance": STORY_MAP_LOCATION_IMPORTANCE.get(kind, 48),
        "aliases": _location_aliases(name, kind=kind, exact_prompt=exact_prompt),
        "description": description,
    }


def _make_route(
    *,
    index: int,
    from_location: dict[str, Any],
    to_location: dict[str, Any],
    kind: str,
    difficulty: float,
    rng: random.Random,
) -> dict[str, Any]:
    start_x = float(from_location["x"])
    start_y = float(from_location["y"])
    end_x = float(to_location["x"])
    end_y = float(to_location["y"])
    mid_x = (start_x + end_x) / 2 + rng.uniform(-56, 56)
    mid_y = (start_y + end_y) / 2 + rng.uniform(-44, 44)
    path = [_point(start_x, start_y), _point(mid_x, mid_y), _point(end_x, end_y)]
    distance = math.dist((start_x, start_y), (mid_x, mid_y)) + math.dist((mid_x, mid_y), (end_x, end_y))
    base_minutes = max(int(round(distance * 1.42 * difficulty)), 35)
    return {
        "id": f"route-{index}",
        "from_location_id": str(from_location["id"]),
        "to_location_id": str(to_location["id"]),
        "kind": kind,
        "travel_minutes": base_minutes,
        "difficulty": round(max(difficulty, 0.8), 2),
        "path": path,
    }


def _story_map_poi_templates_for_location(theme: str, location_kind: str) -> list[tuple[str, str, str]]:
    theme_templates = STORY_MAP_POI_TEMPLATES_BY_THEME.get(theme) or STORY_MAP_POI_TEMPLATES_BY_THEME[STORY_MAP_THEME_FANTASY]
    ordered_keys: list[str] = ["core"]
    if location_kind == "capital":
        ordered_keys.extend(["capital", "city"])
    elif location_kind == "port":
        ordered_keys.extend(["city", "port"])
    else:
        ordered_keys.append(location_kind)
    templates: list[tuple[str, str, str]] = []
    seen_keys: set[str] = set()
    for key in ordered_keys:
        for template in theme_templates.get(key, ()):
            template_key = f"{template[0]}::{template[1]}".casefold()
            if template_key in seen_keys:
                continue
            seen_keys.add(template_key)
            templates.append(template)
    return templates


def _story_map_poi_base_radius(location_kind: str) -> float:
    return {
        "capital": 220.0,
        "city": 190.0,
        "port": 204.0,
        "town": 156.0,
        "fort": 136.0,
        "village": 110.0,
    }.get(location_kind, 104.0)


def _build_story_map_pois(
    *,
    seed: str,
    theme: str,
    locations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    pois: list[dict[str, Any]] = []
    for location in locations:
        location_id = str(location.get("id") or "").strip()
        location_kind = str(location.get("kind") or "").strip().lower()
        if not location_id or not _story_map_location_supports_settlement(location_kind):
            continue
        templates = _story_map_poi_templates_for_location(theme, location_kind)
        if not templates:
            continue
        max_count = max(int(STORY_MAP_POI_COUNT_BY_LOCATION_KIND.get(location_kind, 6)), 1)
        location_seed = hashlib.sha256(f"{seed}:{location_id}:pois".encode("utf-8")).hexdigest()[:16]
        location_rng = _build_rng(location_seed)
        selected_templates = location_rng.sample(templates, k=max_count) if len(templates) > max_count else list(templates)
        center_x = float(location.get("x") or 0.0)
        center_y = float(location.get("y") or 0.0)
        base_radius = _story_map_poi_base_radius(location_kind)
        total_templates = max(len(selected_templates), 1)
        for index, (poi_kind, poi_name, poi_description) in enumerate(selected_templates, start=1):
            angle = ((math.pi * 2) / total_templates) * (index - 1) - (math.pi / 2) + location_rng.uniform(-0.28, 0.28)
            ring_index = (index - 1) // 4
            radius_factor = 0.28 + (ring_index * 0.22) + location_rng.uniform(-0.05, 0.06)
            if poi_kind in {"palace", "keep", "corp_tower", "arcology_core", "hall"}:
                radius_factor = 0.12 + location_rng.uniform(0.0, 0.05)
            elif poi_kind in {"docks", "harbor", "airship_dock", "watchtower", "watchpost", "gate", "water_tower"}:
                radius_factor = 0.82 + location_rng.uniform(-0.06, 0.04)
            radius = max(base_radius * radius_factor, 18.0)
            x = _clamp_coordinate(center_x + math.cos(angle) * radius, upper_bound=STORY_MAP_CANVAS_WIDTH)
            y = _clamp_coordinate(center_y + math.sin(angle) * radius * 0.78, upper_bound=STORY_MAP_CANVAS_HEIGHT)
            pois.append(
                {
                    "id": f"poi-{location_id}-{index}",
                    "location_id": location_id,
                    "region_id": str(location.get("region_id") or "").strip() or None,
                    "name": poi_name,
                    "kind": poi_kind,
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "importance": int(STORY_MAP_POI_IMPORTANCE_BY_KIND.get(poi_kind, 56)),
                    "aliases": _poi_aliases(poi_name, kind=poi_kind),
                    "description": poi_description,
                }
            )
    return pois


def _sanitize_story_map_name(value: Any, *, max_length: int = 80) -> str:
    normalized = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split()).strip(" -,:;")
    if len(normalized) > max_length:
        normalized = normalized[:max_length].rstrip(" -,:;")
    return normalized


def _apply_story_map_ai_overrides(
    payload: dict[str, Any],
    overrides: dict[str, Any],
    *,
    locked_location_ids: set[str] | None = None,
) -> dict[str, Any]:
    locked_ids = {str(value) for value in (locked_location_ids or set()) if str(value).strip()}
    next_payload = json.loads(json.dumps(payload, ensure_ascii=False))

    region_by_id = {
        str(region.get("id")): region
        for region in next_payload.get("regions", [])
        if isinstance(region, dict) and str(region.get("id") or "").strip()
    }
    location_by_id = {
        str(location.get("id")): location
        for location in next_payload.get("locations", [])
        if isinstance(location, dict) and str(location.get("id") or "").strip()
    }
    landmark_by_id = {
        str(landmark.get("id")): landmark
        for landmark in next_payload.get("landmarks", [])
        if isinstance(landmark, dict) and str(landmark.get("id") or "").strip()
    }

    seen_region_names: set[str] = set()
    for region_payload in next_payload.get("regions", []):
        if not isinstance(region_payload, dict):
            continue
        existing_name = _sanitize_story_map_name(region_payload.get("name"))
        if existing_name:
            seen_region_names.add(existing_name.casefold())

    region_items = overrides.get("regions")
    if isinstance(region_items, list):
        for item in region_items:
            if not isinstance(item, dict):
                continue
            region = region_by_id.get(str(item.get("id") or ""))
            if region is None:
                continue
            next_name = _sanitize_story_map_name(item.get("name"))
            if next_name and next_name.casefold() not in seen_region_names:
                previous_name = _sanitize_story_map_name(region.get("name"))
                if previous_name:
                    seen_region_names.discard(previous_name.casefold())
                region["name"] = next_name
                seen_region_names.add(next_name.casefold())
            next_description = _normalize_multiline_text(item.get("description"), max_length=260)
            if next_description:
                region["description"] = next_description

    seen_location_names: set[str] = set()
    for location_payload in next_payload.get("locations", []):
        if not isinstance(location_payload, dict):
            continue
        existing_name = _sanitize_story_map_name(location_payload.get("name"))
        if existing_name:
            seen_location_names.add(existing_name.casefold())

    location_items = overrides.get("locations")
    if isinstance(location_items, list):
        for item in location_items:
            if not isinstance(item, dict):
                continue
            location = location_by_id.get(str(item.get("id") or ""))
            if location is None:
                continue
            if str(location.get("id") or "") not in locked_ids:
                next_name = _sanitize_story_map_name(item.get("name"))
                if next_name and next_name.casefold() not in seen_location_names:
                    previous_name = _sanitize_story_map_name(location.get("name"))
                    if previous_name:
                        seen_location_names.discard(previous_name.casefold())
                    location["name"] = next_name
                    seen_location_names.add(next_name.casefold())
            next_description = _normalize_multiline_text(item.get("description"), max_length=280)
            if next_description:
                location["description"] = next_description
            aliases: list[str] = []
            raw_aliases = item.get("aliases")
            if isinstance(raw_aliases, list):
                for raw_alias in raw_aliases[:8]:
                    alias = _sanitize_story_map_name(raw_alias, max_length=120)
                    if alias:
                        aliases.append(alias)
            location["aliases"] = _location_aliases(
                str(location.get("name") or ""),
                kind=str(location.get("kind") or "city"),
                exact_prompt=aliases[0] if aliases else None,
            )
            for alias in aliases:
                if alias.casefold() not in {value.casefold() for value in location["aliases"]}:
                    location["aliases"].append(alias)

    seen_landmark_names: set[str] = set()
    for landmark_payload in next_payload.get("landmarks", []):
        if not isinstance(landmark_payload, dict):
            continue
        existing_name = _sanitize_story_map_name(landmark_payload.get("name"))
        if existing_name:
            seen_landmark_names.add(existing_name.casefold())

    landmark_items = overrides.get("landmarks")
    if isinstance(landmark_items, list):
        for item in landmark_items:
            if not isinstance(item, dict):
                continue
            landmark = landmark_by_id.get(str(item.get("id") or ""))
            if landmark is None:
                continue
            next_name = _sanitize_story_map_name(item.get("name"))
            if next_name and next_name.casefold() not in seen_landmark_names:
                previous_name = _sanitize_story_map_name(landmark.get("name"))
                if previous_name:
                    seen_landmark_names.discard(previous_name.casefold())
                landmark["name"] = next_name
                seen_landmark_names.add(next_name.casefold())
            next_description = _normalize_multiline_text(item.get("description"), max_length=240)
            if next_description:
                landmark["description"] = next_description

    return next_payload


def _maybe_enrich_story_map_payload_with_ai_details(payload: dict[str, Any]) -> dict[str, Any]:
    if not settings.openrouter_api_key:
        return payload
    try:
        from app.services.story_generation_provider import _request_openrouter_story_text
    except Exception:
        logger.exception("Story map AI enrichment provider import failed")
        return payload

    regions = [region for region in payload.get("regions", []) if isinstance(region, dict)]
    locations = [location for location in payload.get("locations", []) if isinstance(location, dict)]
    landmarks = [landmark for landmark in payload.get("landmarks", []) if isinstance(landmark, dict)]
    if not regions or not locations:
        return payload

    locked_location_ids: set[str] = set()
    explicit_start_name = _extract_explicit_place_name(str(payload.get("start_location") or ""))
    if explicit_start_name and locations:
        locked_location_ids.add(str(locations[0].get("id") or ""))

    map_seed_preview = {
        "theme": str(payload.get("theme") or ""),
        "world_description": _normalize_multiline_text(payload.get("world_description"), max_length=900),
        "start_location": _normalize_text(payload.get("start_location"), max_length=220),
        "regions": [
            {
                "id": str(region.get("id") or ""),
                "kind": str(region.get("kind") or ""),
                "name_seed": _sanitize_story_map_name(region.get("name")),
            }
            for region in regions
        ],
        "locations": [
            {
                "id": str(location.get("id") or ""),
                "region_id": str(location.get("region_id") or ""),
                "kind": str(location.get("kind") or ""),
                "importance": int(location.get("importance") or 0),
                "name_seed": _sanitize_story_map_name(location.get("name")),
                "locked_name": str(location.get("id") or "") in locked_location_ids,
            }
            for location in locations
        ],
        "landmarks": [
            {
                "id": str(landmark.get("id") or ""),
                "region_id": str(landmark.get("region_id") or ""),
                "kind": str(landmark.get("kind") or ""),
                "name_seed": _sanitize_story_map_name(landmark.get("name")),
            }
            for landmark in landmarks
        ],
    }

    messages_payload = [
        {
            "role": "system",
            "content": (
                "You enrich a roleplay world map with unique names and concise lore. "
                "Return JSON only. No markdown, no explanations. "
                "Keep ids unchanged. Respect any locked_name=true entries by preserving their current name seed. "
                "Do not invent more items than provided. "
                "Descriptions must be short, flavorful, and easy for a game UI to display. "
                "Aliases should help text matching and may include short alternate spellings or common references."
            ),
        },
        {
            "role": "user",
            "content": (
                "Create unique map naming and lore for this generated world seed.\n"
                "Return strict JSON with keys regions, locations, landmarks.\n"
                "Each region item: {id, name, description}.\n"
                "Each location item: {id, name, aliases, description}.\n"
                "Each landmark item: {id, name, description}.\n"
                "No extra keys.\n\n"
                f"{json.dumps(map_seed_preview, ensure_ascii=False)}"
            ),
        },
    ]
    try:
        raw_response = _request_openrouter_story_text(
            messages_payload,
            model_name=STORY_MAP_AI_TEXT_MODEL,
            allow_free_fallback=False,
            translate_input=False,
            temperature=0.95,
            max_tokens=STORY_MAP_AI_REQUEST_MAX_TOKENS,
            request_timeout=(12, 60),
        )
    except Exception:
        logger.exception("Story map AI enrichment failed during request")
        return payload

    parsed_payload = _extract_json_object_from_text(raw_response)
    if not isinstance(parsed_payload, dict):
        logger.warning("Story map AI enrichment returned non-JSON payload")
        return payload

    try:
        return _apply_story_map_ai_overrides(
            payload,
            parsed_payload,
            locked_location_ids=locked_location_ids,
        )
    except Exception:
        logger.exception("Story map AI enrichment failed during post-processing")
        return payload


def _generate_story_map_payload(
    *,
    world_description: str,
    start_location: str,
    theme: str,
) -> dict[str, Any]:
    seed = _seed_from_inputs(world_description, start_location, theme)
    rng = _build_rng(seed)
    region_count = 6
    region_anchor_positions = _story_map_region_anchor_positions(region_count)

    regions: list[dict[str, Any]] = []
    for region_index in range(region_count):
        anchor_x, anchor_y = region_anchor_positions[region_index]
        center_x = STORY_MAP_CANVAS_WIDTH * anchor_x + rng.uniform(-42, 42)
        center_y = STORY_MAP_CANVAS_HEIGHT * anchor_y + rng.uniform(-38, 38)
        region_kind = _region_kind_for_theme(theme, region_index)
        regions.append(
            {
                "id": f"reg-{region_index + 1}",
                "name": _pick_name(rng, theme=theme, bucket="region"),
                "kind": region_kind,
                "color": ("#c9b37b", "#7ba6c9", "#9cc989", "#c97ba4")[region_index % 4],
                "center_x": round(center_x, 2),
                "center_y": round(center_y, 2),
                "polygon": _region_blob_polygon(center_x, center_y, rng=rng, radius=rng.uniform(176, 216)),
                "description": f"{STORY_MAP_REGION_KIND_LABELS_RU.get(region_kind, 'регион').capitalize()} с дорогами, поселениями и заметными границами влияния.",
            }
        )

    start_kind = _detect_location_kind(start_location)
    start_name = _extract_explicit_place_name(start_location) or _pick_name(rng, theme=theme, bucket="city")

    locations: list[dict[str, Any]] = []
    region_locations: dict[str, list[dict[str, Any]]] = {}
    location_index = 1
    for region_index, region in enumerate(regions):
        region_id = str(region["id"])
        center_x = float(region["center_x"])
        center_y = float(region["center_y"])
        current_region_locations: list[dict[str, Any]] = []
        capital_location: dict[str, Any] | None = None

        if region_index == 0:
            start_location_entry = _make_location(
                index=location_index,
                name=start_name,
                kind=start_kind,
                region_id=region_id,
                x=center_x - 42,
                y=center_y + 34,
                description=f"Стартовая точка кампании: {_location_display_name(kind=start_kind, name=start_name)}.",
                exact_prompt=start_location,
            )
            current_region_locations.append(start_location_entry)
            locations.append(start_location_entry)
            location_index += 1
            if start_kind == "capital":
                capital_location = start_location_entry
        else:
            capital_location = _make_location(
                index=location_index,
                name=_pick_name(rng, theme=theme, bucket="city"),
                kind="capital",
                region_id=region_id,
                x=center_x + rng.uniform(-44, 44),
                y=center_y - rng.uniform(42, 82),
                description="Главная столица региона с властью, рынками, гарнизоном и крупными дорогами.",
            )
            current_region_locations.append(capital_location)
            locations.append(capital_location)
            location_index += 1

        if capital_location is None:
            capital_location = _make_location(
                index=location_index,
                name=_pick_name(rng, theme=theme, bucket="city"),
                kind="capital",
                region_id=region_id,
                x=center_x + 112,
                y=center_y - 62,
                description="Главная столица региона с властью, рынками, гарнизоном и крупными дорогами.",
            )
            current_region_locations.append(capital_location)
            locations.append(capital_location)
            location_index += 1

        support_kinds = [
            "city",
            "city" if region_index % 2 == 0 else "port",
            "town",
            "town",
            "fort",
            "village",
            "village",
            "port" if region_index % 2 == 0 else "fort",
        ]
        support_count = min(len(support_kinds), 8)
        base_angle = rng.uniform(0, math.pi * 2)
        for support_index in range(support_count):
            if len(locations) >= STORY_MAP_MAX_LOCATIONS:
                break
            support_kind = support_kinds[support_index % len(support_kinds)]
            angle = base_angle + ((math.pi * 2) / support_count) * support_index + rng.uniform(-0.24, 0.24)
            radius = 156 + support_index * 34 + rng.uniform(-18, 26)
            support_location = _make_location(
                index=location_index,
                name=_pick_name(rng, theme=theme, bucket="city"),
                kind=support_kind if region_index != 0 or support_index < 5 else "port",
                region_id=region_id,
                x=center_x + math.cos(angle) * radius,
                y=center_y + math.sin(angle) * radius * 0.76,
                description="Опорная точка карты мира, связанная дорогами с соседними узлами и маршрутами снабжения.",
            )
            current_region_locations.append(support_location)
            locations.append(support_location)
            location_index += 1

        region_locations[region_id] = current_region_locations

    landmarks: list[dict[str, Any]] = []
    landmark_index = 1
    for region in regions:
        region_id = str(region["id"])
        center_x = float(region["center_x"])
        center_y = float(region["center_y"])
        landmark_count = 4 if len(landmarks) <= STORY_MAP_MAX_LANDMARKS - 4 else 2
        for _ in range(landmark_count):
            if len(landmarks) >= STORY_MAP_MAX_LANDMARKS:
                break
            landmarks.append(
                {
                    "id": f"lm-{landmark_index}",
                    "name": _pick_name(rng, theme=theme, bucket="landmark"),
                    "kind": "landmark",
                    "region_id": region_id,
                    "x": round(center_x + rng.uniform(-176, 176), 2),
                    "y": round(center_y + rng.uniform(-146, 146), 2),
                    "description": "Выразительный ориентир на местности и точка местной известности.",
                }
            )
            landmark_index += 1

    routes: list[dict[str, Any]] = []
    route_index = 1
    seen_route_keys: set[tuple[str, str]] = set()

    def append_route(left_location: dict[str, Any], right_location: dict[str, Any], *, intra_region: bool) -> None:
        nonlocal route_index
        location_pair = tuple(sorted((str(left_location["id"]), str(right_location["id"]))))
        if location_pair in seen_route_keys:
            return
        seen_route_keys.add(location_pair)
        route_kind = _route_kind_for_theme(theme, intra_region=intra_region, rng=rng)
        difficulty = 1.0 if route_kind in {"road", "service", "maglev", "rail"} else 1.14
        if route_kind in {"pass", "trail", "causeway"}:
            difficulty = 1.26
        routes.append(
            _make_route(
                index=route_index,
                from_location=left_location,
                to_location=right_location,
                kind=route_kind,
                difficulty=difficulty,
                rng=rng,
            )
        )
        route_index += 1

    for current_region_locations in region_locations.values():
        if len(current_region_locations) < 2:
            continue
        hub = next(
            (location for location in current_region_locations if location["kind"] == "capital"),
            max(current_region_locations, key=lambda item: int(item.get("importance", 0) or 0)),
        )
        for location in current_region_locations:
            if location["id"] == hub["id"] or location["kind"] == "village":
                continue
            append_route(hub, location, intra_region=True)
        orbit_locations = [location for location in current_region_locations if location["id"] != hub["id"]]
        orbit_locations.sort(
            key=lambda item: math.atan2(float(item["y"]) - float(hub["y"]), float(item["x"]) - float(hub["x"]))
        )
        if len(orbit_locations) >= 2:
            for left_location, right_location in zip(orbit_locations, orbit_locations[1:]):
                if left_location["kind"] == "village" and right_location["kind"] == "village":
                    continue
                append_route(left_location, right_location, intra_region=True)
            append_route(orbit_locations[0], orbit_locations[-1], intra_region=True)
        if len(orbit_locations) >= 4:
            append_route(orbit_locations[0], orbit_locations[2], intra_region=True)
            append_route(orbit_locations[1], orbit_locations[3], intra_region=True)

    region_hubs = [
        next(
            (location for location in current_region_locations if location["kind"] == "capital"),
            max(current_region_locations, key=lambda item: int(item.get("importance", 0) or 0)),
        )
        for current_region_locations in region_locations.values()
        if current_region_locations
    ]
    if len(region_hubs) >= 2:
        for index, left_hub in enumerate(region_hubs):
            right_hub = region_hubs[(index + 1) % len(region_hubs)]
            append_route(left_hub, right_hub, intra_region=False)
    region_location_groups = [group for group in region_locations.values() if group]
    if len(region_location_groups) >= 2:
        for index, left_group in enumerate(region_location_groups):
            right_group = region_location_groups[(index + 1) % len(region_location_groups)]
            left_support = [item for item in left_group if item["kind"] in {"city", "port", "town", "fort"}]
            right_support = [item for item in right_group if item["kind"] in {"city", "port", "town", "fort"}]
            if not left_support or not right_support:
                continue
            best_pair: tuple[dict[str, Any], dict[str, Any]] | None = None
            best_distance: float | None = None
            for left_location in left_support:
                for right_location in right_support:
                    candidate_distance = _story_map_distance(
                        float(left_location["x"]),
                        float(left_location["y"]),
                        float(right_location["x"]),
                        float(right_location["y"]),
                    )
                    if best_distance is None or candidate_distance < best_distance:
                        best_distance = candidate_distance
                        best_pair = (left_location, right_location)
            if best_pair is not None:
                append_route(best_pair[0], best_pair[1], intra_region=False)

    pois = _build_story_map_pois(
        seed=seed,
        theme=theme,
        locations=locations[:STORY_MAP_MAX_LOCATIONS],
    )

    payload = {
        "is_enabled": True,
        "theme": theme,
        "seed": seed,
        "canvas_width": STORY_MAP_CANVAS_WIDTH,
        "canvas_height": STORY_MAP_CANVAS_HEIGHT,
        "world_description": world_description,
        "start_location": start_location,
        "overlay_mode": STORY_MAP_OVERLAY_TERRAIN,
        "default_view": STORY_MAP_VIEW_WORLD,
        "current_location_id": str(locations[0]["id"]) if locations else None,
        "current_region_id": str(locations[0]["region_id"]) if locations else None,
        "current_poi_id": None,
        "current_location_label": str(locations[0]["name"]) if locations else "",
        "current_poi_label": "",
        "last_sync_warning": "",
        "regions": regions,
        "locations": locations[:STORY_MAP_MAX_LOCATIONS],
        "pois": pois,
        "routes": routes,
        "landmarks": landmarks[:STORY_MAP_MAX_LANDMARKS],
        "travel_log": [],
        "updated_at": _utcnow_iso(),
    }
    return _maybe_enrich_story_map_payload_with_ai_details(payload)


def _disabled_story_map_state() -> StoryMapStateOut:
    return StoryMapStateOut(
        is_enabled=False,
        theme=STORY_MAP_THEME_FANTASY,
        seed="",
        canvas_width=STORY_MAP_CANVAS_WIDTH,
        canvas_height=STORY_MAP_CANVAS_HEIGHT,
        world_description="",
        start_location="",
        overlay_mode=STORY_MAP_OVERLAY_TERRAIN,
        default_view=STORY_MAP_VIEW_WORLD,
        current_location_id=None,
        current_region_id=None,
        current_poi_id=None,
        current_location_label="",
        current_poi_label="",
        current_anchor_x=None,
        current_anchor_y=None,
        current_anchor_label="",
        current_anchor_scope="location",
        last_sync_warning="",
        regions=[],
        locations=[],
        pois=[],
        routes=[],
        landmarks=[],
        travel_log=[],
        updated_at=None,
    )


def _safe_json_dict(raw_payload: str | None) -> dict[str, Any] | None:
    raw_value = str(raw_payload or "").strip()
    if not raw_value:
        return None
    try:
        parsed = json.loads(raw_value)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _safe_float(raw_value: Any) -> float | None:
    if isinstance(raw_value, bool):
        return None
    if isinstance(raw_value, (int, float)) and math.isfinite(raw_value):
        return float(raw_value)
    return None


def story_map_payload_to_out(*, is_enabled: bool, raw_payload: str | None) -> StoryMapStateOut | None:
    if not is_enabled and not str(raw_payload or "").strip():
        return None

    parsed_payload = _safe_json_dict(raw_payload)
    if not isinstance(parsed_payload, dict):
        disabled_state = _disabled_story_map_state()
        return disabled_state if is_enabled else None

    try:
        return StoryMapStateOut(
            is_enabled=bool(parsed_payload.get("is_enabled", is_enabled)),
            theme=_normalize_theme(
                str(parsed_payload.get("theme") or ""),
                world_description=str(parsed_payload.get("world_description") or ""),
                start_location=str(parsed_payload.get("start_location") or ""),
            ),
            seed=_normalize_text(str(parsed_payload.get("seed") or ""), max_length=32),
            canvas_width=max(int(parsed_payload.get("canvas_width") or STORY_MAP_CANVAS_WIDTH), 640),
            canvas_height=max(int(parsed_payload.get("canvas_height") or STORY_MAP_CANVAS_HEIGHT), 480),
            world_description=_normalize_multiline_text(parsed_payload.get("world_description"), max_length=1_500),
            start_location=_normalize_text(parsed_payload.get("start_location"), max_length=300),
            overlay_mode=(
                STORY_MAP_OVERLAY_POLITICAL
                if str(parsed_payload.get("overlay_mode") or "").strip().lower() == STORY_MAP_OVERLAY_POLITICAL
                else STORY_MAP_OVERLAY_TERRAIN
            ),
            default_view=(
                str(parsed_payload.get("default_view") or STORY_MAP_VIEW_WORLD).strip().lower()
                if str(parsed_payload.get("default_view") or "").strip().lower() in {
                    STORY_MAP_VIEW_WORLD,
                    STORY_MAP_VIEW_REGION,
                    STORY_MAP_VIEW_LOCAL,
                }
                else STORY_MAP_VIEW_WORLD
            ),
            current_location_id=_normalize_text(parsed_payload.get("current_location_id"), max_length=48) or None,
            current_region_id=_normalize_text(parsed_payload.get("current_region_id"), max_length=48) or None,
            current_poi_id=_normalize_text(parsed_payload.get("current_poi_id"), max_length=48) or None,
            current_location_label=_normalize_text(parsed_payload.get("current_location_label"), max_length=160),
            current_poi_label=_normalize_text(parsed_payload.get("current_poi_label"), max_length=160),
            current_anchor_x=_safe_float(parsed_payload.get("current_anchor_x")),
            current_anchor_y=_safe_float(parsed_payload.get("current_anchor_y")),
            current_anchor_label=_normalize_text(parsed_payload.get("current_anchor_label"), max_length=160),
            current_anchor_scope=(
                "poi"
                if str(parsed_payload.get("current_anchor_scope") or "").strip().lower() == "poi"
                else "waypoint"
                if str(parsed_payload.get("current_anchor_scope") or "").strip().lower() == "waypoint"
                else "location"
            ),
            last_sync_warning=_normalize_text(parsed_payload.get("last_sync_warning"), max_length=240),
            regions=[StoryMapRegionOut.model_validate(region) for region in parsed_payload.get("regions", []) if isinstance(region, dict)],
            locations=[StoryMapLocationOut.model_validate(location) for location in parsed_payload.get("locations", []) if isinstance(location, dict)],
            pois=[StoryMapPoiOut.model_validate(poi) for poi in parsed_payload.get("pois", []) if isinstance(poi, dict)],
            routes=[StoryMapRouteOut.model_validate(route) for route in parsed_payload.get("routes", []) if isinstance(route, dict)],
            landmarks=[StoryMapLandmarkOut.model_validate(landmark) for landmark in parsed_payload.get("landmarks", []) if isinstance(landmark, dict)],
            travel_log=[
                StoryMapTravelLogEntryOut.model_validate(entry)
                for entry in parsed_payload.get("travel_log", [])
                if isinstance(entry, dict)
            ][:STORY_MAP_MAX_TRAVEL_LOG],
            updated_at=_normalize_text(parsed_payload.get("updated_at"), max_length=64) or None,
        )
    except Exception:
        disabled_state = _disabled_story_map_state()
        return disabled_state if is_enabled else None


def serialize_story_map_payload(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _seed_story_map_anchor_fields(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return payload
    current_location_id = _normalize_text(payload.get("current_location_id"), max_length=48)
    locations = payload.get("locations")
    if not current_location_id or not isinstance(locations, list):
        return payload
    current_location = next(
        (
            item
            for item in locations
            if isinstance(item, dict)
            and _normalize_text(item.get("id"), max_length=48) == current_location_id
        ),
        None,
    )
    if not isinstance(current_location, dict):
        return payload
    next_payload = dict(payload)
    next_payload["current_anchor_x"] = _safe_float(current_location.get("x"))
    next_payload["current_anchor_y"] = _safe_float(current_location.get("y"))
    next_payload["current_anchor_label"] = (
        _normalize_text(current_location.get("name"), max_length=160)
        or _normalize_text(next_payload.get("current_location_label"), max_length=160)
    )
    next_payload["current_anchor_scope"] = "location"
    return next_payload


def _build_story_map_reference_description(*, game: StoryGame, world_description: str) -> str:
    normalized_world_description = _normalize_multiline_text(world_description, max_length=1_500)
    extra_parts = [
        _normalize_text(getattr(game, "title", None), max_length=160),
        _normalize_multiline_text(getattr(game, "description", None), max_length=360),
        _normalize_multiline_text(getattr(game, "opening_scene", None), max_length=420),
    ]
    combined_parts = [normalized_world_description, *[part for part in extra_parts if part]]
    return _normalize_multiline_text("\n\n".join(part for part in combined_parts if part), max_length=1_500)


def initialize_story_map_for_game(
    *,
    game: StoryGame,
    world_description: str,
    start_location: str,
    theme: str | None = None,
) -> StoryMapStateOut:
    normalized_world_description = _build_story_map_reference_description(
        game=game,
        world_description=world_description,
    )
    normalized_start_location = _normalize_text(start_location, max_length=300)
    resolved_theme = _normalize_theme(
        theme,
        world_description=normalized_world_description,
        start_location=normalized_start_location,
    )
    payload = _generate_story_map_payload(
        world_description=normalized_world_description,
        start_location=normalized_start_location,
        theme=resolved_theme,
    )
    payload = _seed_story_map_anchor_fields(payload)
    game.story_map_enabled = True
    game.story_map_payload = serialize_story_map_payload(payload)
    return story_map_payload_to_out(is_enabled=True, raw_payload=game.story_map_payload) or _disabled_story_map_state()


def disable_story_map_for_game(*, game: StoryGame) -> None:
    game.story_map_enabled = False
    game.story_map_payload = ""


def _normalize_story_map_image_scope(value: str | None) -> str:
    normalized = _normalize_text(value, max_length=24).lower()
    if normalized in STORY_MAP_IMAGE_SCOPES:
        return normalized
    return STORY_MAP_IMAGE_SCOPE_WORLD


def _coerce_story_map_image_model(value: str | None) -> str:
    normalized = coerce_story_image_model(value)
    if normalized in STORY_MAP_IMAGE_ALLOWED_MODELS:
        return normalized
    return STORY_IMAGE_MODEL_FLUX


def _get_story_map_image_cost_tokens(model_name: str | None) -> int:
    return max(int(STORY_MAP_IMAGE_COST_BY_MODEL.get(_coerce_story_map_image_model(model_name), 0)), 0)


def _story_map_image_to_out(image: StoryMapImage) -> StoryMapImageOut:
    return StoryMapImageOut(
        id=int(image.id),
        scope=_normalize_story_map_image_scope(getattr(image, "scope", None)),
        target_region_id=_normalize_text(getattr(image, "target_region_id", None), max_length=48) or None,
        target_location_id=_normalize_text(getattr(image, "target_location_id", None), max_length=48) or None,
        target_label=_normalize_text(getattr(image, "target_label", None), max_length=160),
        model=_normalize_text(getattr(image, "model", None), max_length=120),
        prompt=_normalize_multiline_text(getattr(image, "prompt", None), max_length=16_000),
        revised_prompt=_normalize_multiline_text(getattr(image, "revised_prompt", None), max_length=16_000) or None,
        image_url=_normalize_text(getattr(image, "image_url", None), max_length=16_000) or None,
        image_data_url=_normalize_text(getattr(image, "image_data_url", None), max_length=2_000_000) or None,
        created_at=image.created_at,
        updated_at=image.updated_at,
    )


def list_story_map_images_for_game(*, db: Session, game: StoryGame) -> list[StoryMapImageOut]:
    items = db.scalars(
        select(StoryMapImage)
        .where(
            StoryMapImage.game_id == game.id,
            StoryMapImage.undone_at.is_(None),
        )
        .order_by(StoryMapImage.created_at.desc(), StoryMapImage.id.desc())
        .limit(STORY_MAP_IMAGE_ACTIVE_LIMIT)
    ).all()
    return [_story_map_image_to_out(item) for item in items]


def _story_map_location_by_id(payload: StoryMapStateOut) -> dict[str, StoryMapLocationOut]:
    return {location.id: location for location in payload.locations}


def _story_map_region_by_id(payload: StoryMapStateOut) -> dict[str, StoryMapRegionOut]:
    return {region.id: region for region in payload.regions}


def _story_map_poi_by_id(payload: StoryMapStateOut) -> dict[str, StoryMapPoiOut]:
    return {poi.id: poi for poi in payload.pois}


def _story_map_pois_for_location(payload: StoryMapStateOut, location_id: str | None) -> list[StoryMapPoiOut]:
    normalized_location_id = _normalize_text(location_id, max_length=48) or None
    if normalized_location_id is None:
        return []
    return [poi for poi in payload.pois if poi.location_id == normalized_location_id]


def _resolve_story_map_image_targets(
    payload: StoryMapStateOut,
    *,
    scope: str,
    target_region_id: str | None,
    target_location_id: str | None,
) -> tuple[str | None, str | None, str]:
    location_by_id = _story_map_location_by_id(payload)
    region_by_id = _story_map_region_by_id(payload)
    normalized_scope = _normalize_story_map_image_scope(scope)
    normalized_region_id = _normalize_text(target_region_id, max_length=48) or None
    normalized_location_id = _normalize_text(target_location_id, max_length=48) or None

    if normalized_scope == STORY_MAP_IMAGE_SCOPE_WORLD:
        return (None, None, payload.world_description or payload.start_location or "World map")

    if normalized_scope == STORY_MAP_IMAGE_SCOPE_EMPIRES:
        region = region_by_id.get(normalized_region_id or "") if normalized_region_id else None
        if region is None and payload.current_region_id:
            region = region_by_id.get(payload.current_region_id)
        if region is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empire target for map image was not found")
        return (region.id, None, region.name)

    if normalized_scope == STORY_MAP_IMAGE_SCOPE_REGION:
        region = region_by_id.get(normalized_region_id or "") if normalized_region_id else None
        location = location_by_id.get(normalized_location_id or "") if normalized_location_id else None
        if region is None and payload.current_region_id:
            region = region_by_id.get(payload.current_region_id)
        if location is None and payload.current_location_id:
            location = location_by_id.get(payload.current_location_id)
        if region is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Region target for map image was not found")
        if location is not None and location.region_id != region.id:
            location = None
        if location is not None:
            return (region.id, location.id, f"{region.name} — {location.name}")
        return (region.id, None, region.name)

    location = location_by_id.get(normalized_location_id or "") if normalized_location_id else None
    if location is None and payload.current_location_id:
        location = location_by_id.get(payload.current_location_id)
    if location is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Location target for map image was not found")
    if normalized_scope == STORY_MAP_IMAGE_SCOPE_SETTLEMENT:
        current_location = location_by_id.get(payload.current_location_id or "") if payload.current_location_id else None
        if current_location is None or current_location.id != location.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Settlement map is available only for the current location")
        if not _story_map_location_supports_settlement(location.kind):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current location does not support settlement detail")
    resolved_region_id = location.region_id if isinstance(location.region_id, str) and location.region_id.strip() else None
    return (resolved_region_id, location.id, location.name)


def _story_map_reference_view_box(
    payload: StoryMapStateOut,
    *,
    scope: str,
    target_region_id: str | None,
    target_location_id: str | None,
) -> tuple[float, float, float, float]:
    canvas_width = max(int(payload.canvas_width or STORY_MAP_CANVAS_WIDTH), 640)
    canvas_height = max(int(payload.canvas_height or STORY_MAP_CANVAS_HEIGHT), 480)
    location_by_id = _story_map_location_by_id(payload)
    target_location = location_by_id.get(target_location_id or "") if target_location_id else None
    if scope == STORY_MAP_IMAGE_SCOPE_WORLD:
        return (0.0, 0.0, float(canvas_width), float(canvas_height))
    if scope == STORY_MAP_IMAGE_SCOPE_EMPIRES and target_region_id:
        region = _story_map_region_by_id(payload).get(target_region_id)
        if region is not None and region.polygon:
            frame = _story_map_frame_from_points(
                [(point.x, point.y) for point in region.polygon],
                canvas_width=float(canvas_width),
                canvas_height=float(canvas_height),
                padding=180.0,
                min_width=880.0,
                min_height=640.0,
            )
            if frame is not None:
                return frame
    if scope == STORY_MAP_IMAGE_SCOPE_REGION and target_region_id:
        region_locations = [location for location in payload.locations if location.region_id == target_region_id]
        region_landmarks = [landmark for landmark in payload.landmarks if landmark.region_id == target_region_id]
        if target_location is not None and target_location.region_id == target_region_id:
            focus_points = [(target_location.x, target_location.y)]
            focus_points.extend(
                (location.x, location.y)
                for location in region_locations
                if _story_map_distance(location.x, location.y, target_location.x, target_location.y) <= 460.0
            )
            focus_points.extend(
                (landmark.x, landmark.y)
                for landmark in region_landmarks
                if _story_map_distance(landmark.x, landmark.y, target_location.x, target_location.y) <= 420.0
            )
            frame = _story_map_frame_from_points(
                focus_points,
                canvas_width=float(canvas_width),
                canvas_height=float(canvas_height),
                padding=160.0,
                min_width=860.0,
                min_height=620.0,
            )
            if frame is not None:
                return frame
        frame = _story_map_frame_from_points(
            [(location.x, location.y) for location in region_locations]
            + [(landmark.x, landmark.y) for landmark in region_landmarks],
            canvas_width=float(canvas_width),
            canvas_height=float(canvas_height),
            padding=150.0,
            min_width=920.0,
            min_height=680.0,
        )
        if frame is not None:
            return frame
    if target_location is not None:
        if scope == STORY_MAP_IMAGE_SCOPE_SETTLEMENT:
            settlement_points = [(target_location.x, target_location.y)] + [
                (poi.x, poi.y) for poi in _story_map_pois_for_location(payload, target_location.id)
            ]
            frame = _story_map_frame_from_points(
                settlement_points,
                canvas_width=float(canvas_width),
                canvas_height=float(canvas_height),
                padding=120.0,
                min_width=720.0,
                min_height=540.0,
            )
            if frame is not None:
                return frame
        nearby_points = [(target_location.x, target_location.y)]
        nearby_points.extend(
            (location.x, location.y)
            for location in payload.locations
            if _story_map_distance(location.x, location.y, target_location.x, target_location.y) <= 430.0
        )
        nearby_points.extend(
            (landmark.x, landmark.y)
            for landmark in payload.landmarks
            if _story_map_distance(landmark.x, landmark.y, target_location.x, target_location.y) <= 360.0
        )
        nearby_points.extend(
            (poi.x, poi.y)
            for poi in _story_map_pois_for_location(payload, target_location.id)
            if int(poi.importance or 0) >= 78
        )
        frame = _story_map_frame_from_points(
            nearby_points,
            canvas_width=float(canvas_width),
            canvas_height=float(canvas_height),
            padding=150.0,
            min_width=860.0,
            min_height=620.0,
        )
        if frame is not None:
            return frame
    return (0.0, 0.0, float(canvas_width), float(canvas_height))


def _polygon_path_from_points(points: list[StoryMapPointOut]) -> str:
    if not points:
        return ""
    first_point, *other_points = points
    return "M " + " ".join(
        [f"{first_point.x:.2f} {first_point.y:.2f}", *[f"L {point.x:.2f} {point.y:.2f}" for point in other_points], "Z"]
    )


def _route_path_from_route(route: StoryMapRouteOut, location_by_id: dict[str, StoryMapLocationOut]) -> str:
    path_points = route.path
    if not path_points:
        from_location = location_by_id.get(route.from_location_id)
        to_location = location_by_id.get(route.to_location_id)
        if from_location is None or to_location is None:
            return ""
        path_points = [
            StoryMapPointOut(x=from_location.x, y=from_location.y),
            StoryMapPointOut(x=to_location.x, y=to_location.y),
        ]
    if not path_points:
        return ""
    first_point, *other_points = path_points
    return "M " + " ".join(
        [f"{first_point.x:.2f} {first_point.y:.2f}", *[f"L {point.x:.2f} {point.y:.2f}" for point in other_points]]
    )


def _story_map_rgba_from_color(
    raw_value: str | None,
    *,
    alpha: int,
    fallback: tuple[int, int, int],
) -> tuple[int, int, int, int]:
    normalized = str(raw_value or "").strip()
    if normalized.startswith("#"):
        normalized = normalized[1:]
    if len(normalized) == 3:
        normalized = "".join(char * 2 for char in normalized)
    if len(normalized) != 6:
        red, green, blue = fallback
        return (red, green, blue, alpha)
    try:
        red = int(normalized[0:2], 16)
        green = int(normalized[2:4], 16)
        blue = int(normalized[4:6], 16)
    except ValueError:
        red, green, blue = fallback
        return (red, green, blue, alpha)
    return (red, green, blue, alpha)


def _draw_story_map_dashed_polyline(
    draw: Any,
    points: list[tuple[float, float]],
    *,
    fill: tuple[int, int, int, int],
    width: int,
    dash_length: float = 14.0,
    gap_length: float = 10.0,
) -> None:
    if len(points) < 2:
        return
    for index in range(len(points) - 1):
        start_x, start_y = points[index]
        end_x, end_y = points[index + 1]
        delta_x = end_x - start_x
        delta_y = end_y - start_y
        segment_length = math.hypot(delta_x, delta_y)
        if segment_length <= 0:
            continue
        direction_x = delta_x / segment_length
        direction_y = delta_y / segment_length
        progress = 0.0
        while progress < segment_length:
            dash_end = min(progress + dash_length, segment_length)
            dash_start_point = (
                start_x + direction_x * progress,
                start_y + direction_y * progress,
            )
            dash_end_point = (
                start_x + direction_x * dash_end,
                start_y + direction_y * dash_end,
            )
            draw.line([dash_start_point, dash_end_point], fill=fill, width=width)
            progress += dash_length + gap_length


def _build_story_map_reference_image_data_url(
    payload: StoryMapStateOut,
    *,
    scope: str,
    target_region_id: str | None,
    target_location_id: str | None,
) -> str | None:
    pillow_modules = _load_pillow_modules()
    if pillow_modules is None:
        logger.warning("Pillow is unavailable for story map reference rasterization")
        return None
    Image, _, _ = pillow_modules
    try:
        from PIL import ImageDraw
    except Exception:
        logger.warning("Pillow ImageDraw is unavailable for story map reference rasterization")
        return None

    normalized_scope = _normalize_story_map_image_scope(scope)
    location_by_id = _story_map_location_by_id(payload)
    target_location = location_by_id.get(target_location_id or "") if target_location_id else None
    view_x, view_y, view_width, view_height = _story_map_reference_view_box(
        payload,
        scope=normalized_scope,
        target_region_id=target_region_id,
        target_location_id=target_location_id,
    )
    target_width = 1400
    target_height = 960
    safe_view_width = max(float(view_width), 1.0)
    safe_view_height = max(float(view_height), 1.0)
    scale_x = target_width / safe_view_width
    scale_y = target_height / safe_view_height

    def project_point(point: StoryMapPointOut) -> tuple[float, float]:
        return (
            (float(point.x) - float(view_x)) * scale_x,
            (float(point.y) - float(view_y)) * scale_y,
        )

    def point_visible(x: float, y: float, *, padding: float = 0.0) -> bool:
        return (
            (float(view_x) - padding) <= float(x) <= (float(view_x) + float(view_width) + padding)
            and (float(view_y) - padding) <= float(y) <= (float(view_y) + float(view_height) + padding)
        )

    def location_visible(location: StoryMapLocationOut) -> bool:
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_WORLD:
            return location.kind == "capital" or location.id == payload.current_location_id
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_EMPIRES:
            return bool(
                target_region_id
                and location.region_id == target_region_id
                and (
                    location.kind in {"capital", "city", "port", "fort"}
                    or int(location.importance or 0) >= 62
                )
            )
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_REGION:
            return bool(
                target_region_id
                and location.region_id == target_region_id
                and point_visible(location.x, location.y, padding=150.0)
            )
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_SETTLEMENT:
            return bool(target_location is not None and location.id == target_location.id)
        if target_location is not None and location.id == target_location.id:
            return True
        return point_visible(location.x, location.y, padding=126.0)

    def route_visible(route: StoryMapRouteOut) -> bool:
        from_location = location_by_id.get(route.from_location_id)
        to_location = location_by_id.get(route.to_location_id)
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_WORLD:
            if from_location is None or to_location is None:
                return False
            return from_location.kind == "capital" and to_location.kind == "capital"
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_EMPIRES:
            if target_region_id is None or from_location is None or to_location is None:
                return False
            return (
                from_location.region_id == target_region_id
                and to_location.region_id == target_region_id
                and max(int(from_location.importance or 0), int(to_location.importance or 0)) >= 62
                and not (from_location.kind == "village" and to_location.kind == "village")
            )
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_REGION:
            if target_region_id is None:
                return False
            return bool(
                (
                    from_location is not None
                    and from_location.region_id == target_region_id
                    and point_visible(from_location.x, from_location.y, padding=160.0)
                )
                or (
                    to_location is not None
                    and to_location.region_id == target_region_id
                    and point_visible(to_location.x, to_location.y, padding=160.0)
                )
            )
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_SETTLEMENT:
            return False
        if target_location is not None and {route.from_location_id, route.to_location_id} & {target_location.id}:
            return True
        if from_location is not None and point_visible(from_location.x, from_location.y, padding=140.0):
            return True
        if to_location is not None and point_visible(to_location.x, to_location.y, padding=140.0):
            return True
        return False

    def landmark_visible(landmark: StoryMapLandmarkOut) -> bool:
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_WORLD:
            return False
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_EMPIRES:
            return False
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_REGION:
            return bool(
                target_region_id
                and landmark.region_id == target_region_id
                and point_visible(landmark.x, landmark.y, padding=140.0)
            )
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_SETTLEMENT:
            return False
        return point_visible(landmark.x, landmark.y, padding=90.0)

    def poi_visible(poi: StoryMapPoiOut) -> bool:
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_SETTLEMENT:
            return bool(target_location is not None and poi.location_id == target_location.id)
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_LOCAL:
            return bool(target_location is not None and poi.location_id == target_location.id and int(poi.importance or 0) >= 80)
        return False

    def region_visible(region: StoryMapRegionOut) -> bool:
        if normalized_scope == STORY_MAP_IMAGE_SCOPE_WORLD:
            return True
        if normalized_scope in {STORY_MAP_IMAGE_SCOPE_EMPIRES, STORY_MAP_IMAGE_SCOPE_REGION}:
            return bool(target_region_id and region.id == target_region_id)
        return False

    def draw_poi_marker(x: float, y: float, *, poi_kind: str, selected: bool) -> None:
        fill = (255, 179, 82, 235) if selected else (191, 227, 255, 224)
        outline = (255, 255, 255, 180)
        if poi_kind in {"palace", "keep", "corp_tower", "arcology_core", "manor"}:
            draw.polygon([(x, y - 10), (x + 9, y), (x, y + 10), (x - 9, y)], fill=fill, outline=outline)
            return
        if poi_kind in {"market", "bazaar", "barter_market", "plaza", "neon_plaza"}:
            draw.rectangle((x - 8, y - 8, x + 8, y + 8), fill=fill, outline=outline, width=2)
            return
        if poi_kind in {"smithy", "workshop", "foundry", "garage", "armory", "salvage_yard"}:
            draw.polygon([(x, y - 9), (x + 8, y - 3), (x + 5, y + 8), (x - 5, y + 8), (x - 8, y - 3)], fill=fill, outline=outline)
            return
        if poi_kind in {"temple", "chapel", "shrine", "clinic", "academy", "observatory"}:
            draw.polygon([(x, y - 10), (x + 9, y + 8), (x - 9, y + 8)], fill=fill, outline=outline)
            return
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=fill, outline=outline, width=2)

    image = Image.new("RGBA", (target_width, target_height), (13, 21, 34, 255))
    draw = ImageDraw.Draw(image, "RGBA")

    grid_spacing_x = max(18, int(round(72 * scale_x)))
    grid_spacing_y = max(18, int(round(72 * scale_y)))
    for x in range(0, target_width + 1, grid_spacing_x):
        draw.line([(x, 0), (x, target_height)], fill=(255, 255, 255, 14), width=1)
    for y in range(0, target_height + 1, grid_spacing_y):
        draw.line([(0, y), (target_width, y)], fill=(255, 255, 255, 14), width=1)

    for region in payload.regions:
        if not region_visible(region):
            continue
        if len(region.polygon) < 3:
            continue
        projected_polygon = [project_point(point) for point in region.polygon]
        fill_rgba = _story_map_rgba_from_color(
            region.color if normalized_scope == STORY_MAP_IMAGE_SCOPE_EMPIRES else None,
            alpha=66,
            fallback=(255, 255, 255),
        )
        draw.polygon(projected_polygon, fill=fill_rgba, outline=(255, 255, 255, 90))
    for route in payload.routes:
        if not route_visible(route):
            continue
        route_points = route.path
        if not route_points:
            from_location = location_by_id.get(route.from_location_id)
            to_location = location_by_id.get(route.to_location_id)
            if from_location is None or to_location is None:
                continue
            route_points = [
                StoryMapPointOut(x=from_location.x, y=from_location.y),
                StoryMapPointOut(x=to_location.x, y=to_location.y),
            ]
        projected_route = [project_point(point) for point in route_points]
        if len(projected_route) < 2:
            continue
        if route.kind in {"trail", "pass"}:
            _draw_story_map_dashed_polyline(
                draw,
                projected_route,
                fill=(240, 222, 156, 194),
                width=4,
            )
        else:
            draw.line(projected_route, fill=(240, 222, 156, 194), width=4)
    for landmark in payload.landmarks:
        if not landmark_visible(landmark):
            continue
        projected_x = (float(landmark.x) - float(view_x)) * scale_x
        projected_y = (float(landmark.y) - float(view_y)) * scale_y
        diamond_points = [
            (projected_x, projected_y - 9),
            (projected_x + 7, projected_y),
            (projected_x, projected_y + 9),
            (projected_x - 7, projected_y),
        ]
        draw.polygon(diamond_points, fill=(230, 211, 143, 230))
    for poi in payload.pois:
        if not poi_visible(poi):
            continue
        projected_x = (float(poi.x) - float(view_x)) * scale_x
        projected_y = (float(poi.y) - float(view_y)) * scale_y
        draw_poi_marker(
            projected_x,
            projected_y,
            poi_kind=poi.kind,
            selected=bool(payload.current_poi_id and poi.id == payload.current_poi_id),
        )
    for location in payload.locations:
        if not location_visible(location):
            continue
        radius = 13 if location.kind == "capital" else 10 if location.kind in {"city", "port"} else 8
        is_target = (
            (target_location_id and location.id == target_location_id)
            or (
                not target_location_id
                and location.id == payload.current_location_id
                and (target_region_id is None or location.region_id == target_region_id)
            )
        )
        highlight_radius = radius + (7 if is_target else 0)
        projected_x = (float(location.x) - float(view_x)) * scale_x
        projected_y = (float(location.y) - float(view_y)) * scale_y
        if is_target:
            draw.ellipse(
                (
                    projected_x - highlight_radius,
                    projected_y - highlight_radius,
                    projected_x + highlight_radius,
                    projected_y + highlight_radius,
                ),
                fill=(255, 159, 110, 50),
            )
        draw.ellipse(
            (
                projected_x - radius,
                projected_y - radius,
                projected_x + radius,
                projected_y + radius,
            ),
            fill=(255, 159, 110, 255) if is_target else (143, 190, 117, 255),
            outline=(255, 255, 255, 112),
            width=2,
        )
    output_buffer = io.BytesIO()
    image.save(output_buffer, format="PNG")
    encoded = base64.b64encode(output_buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _story_map_focus_locations_for_region(
    payload: StoryMapStateOut,
    *,
    region_id: str | None,
    limit: int,
) -> list[StoryMapLocationOut]:
    if region_id is None:
        return []
    return sorted(
        [location for location in payload.locations if location.region_id == region_id],
        key=lambda item: (int(item.importance or 0), item.name),
        reverse=True,
    )[:limit]


def _story_map_focus_pois_for_location(
    payload: StoryMapStateOut,
    *,
    location_id: str | None,
    limit: int,
) -> list[StoryMapPoiOut]:
    return sorted(
        _story_map_pois_for_location(payload, location_id),
        key=lambda item: (int(item.importance or 0), item.name),
        reverse=True,
    )[:limit]


def _build_story_map_image_prompt(
    payload: StoryMapStateOut,
    *,
    scope: str,
    target_region_id: str | None,
    target_location_id: str | None,
    target_label: str,
    has_reference_image: bool = True,
) -> str:
    normalized_scope = _normalize_story_map_image_scope(scope)
    region_by_id = _story_map_region_by_id(payload)
    location_by_id = _story_map_location_by_id(payload)
    target_region = region_by_id.get(target_region_id or "") if target_region_id else None
    target_location = location_by_id.get(target_location_id or "") if target_location_id else None
    focus_locations = _story_map_focus_locations_for_region(
        payload,
        region_id=target_region.id if target_region is not None else None,
        limit=10 if normalized_scope == STORY_MAP_IMAGE_SCOPE_EMPIRES else 8,
    )
    focus_pois = _story_map_focus_pois_for_location(
        payload,
        location_id=target_location.id if target_location is not None else None,
        limit=12 if normalized_scope == STORY_MAP_IMAGE_SCOPE_SETTLEMENT else 8,
    )
    scope_brief = {
        STORY_MAP_IMAGE_SCOPE_WORLD: "a full world atlas with all empire silhouettes and every capital anchor visible at once",
        STORY_MAP_IMAGE_SCOPE_EMPIRES: "a large empire-scale political map of one empire with a capital, major cities, forts, ports, mines, and strategic trunk roads",
        STORY_MAP_IMAGE_SCOPE_REGION: "a large regional map centered on the current sub-region inside the empire, with nearby towns, forts, bridges, rivers, shrines, passes, and the local road network",
        STORY_MAP_IMAGE_SCOPE_LOCAL: "a close local-area map around the current settlement with nearby roads, side villages, farms, bridges, ruins, approaches, and outdoor landmarks",
        STORY_MAP_IMAGE_SCOPE_SETTLEMENT: "a huge orthographic settlement map of the current city or village, filling the frame with districts, streets, courtyards, squares, walls, gardens, workshops, docks, and many distinct buildings",
    }.get(normalized_scope, "a detailed fantasy atlas map")
    detail_lines = [
        f"Theme: {payload.theme}.",
        f"World premise: {_normalize_multiline_text(payload.world_description, max_length=900)}",
        f"Requested layer: {normalized_scope}.",
        f"Target focus: {target_label}.",
        "Strict top-down orthographic map art only, no perspective scene and no scenic horizon.",
        "One continuous map only. Fill almost the entire frame with geography, roads, districts, buildings, and terrain.",
        "Show more routes than a minimal sketch: secondary roads, branch trails, passes, river crossings, feeder routes, and connecting paths where appropriate.",
        "ABSOLUTE BAN ON TEXT INSIDE THE IMAGE: no labels, no titles, no compass words, no numbers, no map key, no readable runes, no fake calligraphy, no letter-like sigils.",
        "Any signs, banners, storefront boards, flags, gate plaques, milestone stones, scrolls, emblems, and shopfront ornaments must stay blank or purely pictorial, never readable.",
        "ABSOLUTE BAN ON DECORATIVE UI ORNAMENTS: no cartouches, no scroll panels, no border frames, no inset pictures, no icon sheets, no miniature scenes, no stickers, no cards, no badges.",
        "Leave label-friendly negative space around important places so UI text can be added later.",
    ]
    if has_reference_image:
        detail_lines.extend(
            [
                "Use the supplied structural reference strictly for composition, coastlines, borders, routes, settlement placement, and relative spacing.",
                "Preserve the same overall geometry so the final image can sit under a vector overlay across every zoom layer.",
                "Do not crop the map into a strip, vignette, banner, or narrow slice. The full map must occupy the frame edge to edge.",
            ]
        )
    else:
        detail_lines.extend(
            [
                "Build a clean atlas-like composition with believable geography and readable settlement spacing.",
                "Keep roads, rivers, and terrain laid out in a way that can support a later gameplay overlay.",
            ]
        )
    if target_region is not None:
        detail_lines.append(f"Focused region flavor: {target_region.name}. {target_region.description}")
    if target_location is not None:
        detail_lines.append(
            f"Focused settlement flavor: {target_location.name} ({target_location.kind}). {target_location.description}"
        )
    if normalized_scope == STORY_MAP_IMAGE_SCOPE_REGION and target_location is not None and target_region is not None:
        detail_lines.append(
            f"Region layer must feel narrower and more detailed than the empire layer: center the map around {target_location.name} inside {target_region.name}."
        )
    if focus_locations and normalized_scope in {STORY_MAP_IMAGE_SCOPE_EMPIRES, STORY_MAP_IMAGE_SCOPE_REGION}:
        detail_lines.append(
            "Important settlements and anchors to preserve: "
            + "; ".join(
                f"{location.name} ({location.kind})"
                for location in focus_locations
            )
            + "."
        )
    if focus_pois and normalized_scope in {STORY_MAP_IMAGE_SCOPE_LOCAL, STORY_MAP_IMAGE_SCOPE_SETTLEMENT}:
        detail_lines.append(
            "Visible settlement anchors that must read clearly through architecture and icon-like silhouettes: "
            + "; ".join(
                f"{poi.name} ({poi.kind})"
                for poi in focus_pois
            )
            + "."
        )
        detail_lines.append(
            "Render those settlement anchors as distinct buildings, compounds, plazas, gardens, docks, towers, shrines, or workshops in the exact structural positions from the reference."
        )
        detail_lines.append(
            "For settlement scope, do not paint a tiny hamlet vignette. Paint a large readable town or city plan that fills the frame and gives every anchor its own footprint."
        )
    detail_lines.append(f"Scene brief for the artwork: {scope_brief}.")
    return "\n".join(line for line in detail_lines if line).strip()


def get_story_map_state_or_400(game: StoryGame) -> StoryMapStateOut:
    payload = story_map_payload_to_out(
        is_enabled=bool(getattr(game, "story_map_enabled", False)),
        raw_payload=str(getattr(game, "story_map_payload", "") or ""),
    )
    if payload is None or not payload.is_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Story map is disabled")
    return payload


def generate_story_map_image_impl(
    *,
    game_id: int,
    payload: StoryMapImageGenerateRequest,
    authorization: str | None,
    db: Session,
) -> StoryMapImageGenerateOut:
    from app.services.story_visuals import _request_story_turn_image, _validate_story_turn_image_provider_config

    user = get_current_user(db, authorization)
    if str(getattr(user, "role", "") or "").strip().lower() != "administrator":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    game = get_user_story_game_or_404(db, user.id, game_id)
    map_payload = get_story_map_state_or_400(game)
    normalized_scope = _normalize_story_map_image_scope(payload.scope)
    selected_model = _coerce_story_map_image_model(payload.image_model)
    _validate_story_turn_image_provider_config(selected_model)

    resolved_region_id, resolved_location_id, target_label = _resolve_story_map_image_targets(
        map_payload,
        scope=normalized_scope,
        target_region_id=payload.target_region_id,
        target_location_id=payload.target_location_id,
    )
    reference_image_data_url = _build_story_map_reference_image_data_url(
        map_payload,
        scope=normalized_scope,
        target_region_id=resolved_region_id,
        target_location_id=resolved_location_id,
    )
    prompt_text = _build_story_map_image_prompt(
        map_payload,
        scope=normalized_scope,
        target_region_id=resolved_region_id,
        target_location_id=resolved_location_id,
        target_label=target_label,
        has_reference_image=bool(reference_image_data_url),
    )

    generation_cost = _get_story_map_image_cost_tokens(selected_model)
    if not _spend_user_tokens_if_sufficient(db, int(user.id), generation_cost):
        db.rollback()
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Not enough sols to generate map image")
    db.commit()
    db.refresh(user)

    logger.info(
        "Story map image generation started: game_id=%s scope=%s model=%s target_region_id=%s target_location_id=%s cost=%s",
        game.id,
        normalized_scope,
        selected_model,
        resolved_region_id,
        resolved_location_id,
        generation_cost,
    )
    try:
        generation_payload = _request_story_turn_image(
            prompt=prompt_text,
            model_name=selected_model,
            reference_image_data_url=reference_image_data_url,
        )
    except Exception as exc:
        try:
            _add_user_tokens(db, int(user.id), generation_cost)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            logger.exception("Story map image token refund failed after generation error: game_id=%s", game.id)
        logger.exception("Story map image generation failed: game_id=%s scope=%s", game.id, normalized_scope)
        detail = str(exc).strip() or "Map image generation failed"
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail[:500]) from exc

    resolved_model = _normalize_text(generation_payload.get("model"), max_length=120) or selected_model
    resolved_revised_prompt = _normalize_multiline_text(generation_payload.get("revised_prompt"), max_length=16_000) or None
    resolved_image_url = _normalize_text(generation_payload.get("image_url"), max_length=16_000) or None
    resolved_image_data_url = _normalize_text(generation_payload.get("image_data_url"), max_length=2_000_000) or None

    try:
        previous_images = db.scalars(
            select(StoryMapImage).where(
                StoryMapImage.game_id == game.id,
                StoryMapImage.scope == normalized_scope,
                StoryMapImage.target_region_id.is_(resolved_region_id) if resolved_region_id is None else StoryMapImage.target_region_id == resolved_region_id,
                StoryMapImage.target_location_id.is_(resolved_location_id) if resolved_location_id is None else StoryMapImage.target_location_id == resolved_location_id,
                StoryMapImage.undone_at.is_(None),
            )
        ).all()
        if previous_images:
            replaced_at = datetime.now(timezone.utc)
            for item in previous_images:
                item.undone_at = replaced_at

        persisted_image = StoryMapImage(
            game_id=game.id,
            scope=normalized_scope,
            target_region_id=resolved_region_id,
            target_location_id=resolved_location_id,
            target_label=_normalize_text(target_label, max_length=160),
            model=resolved_model,
            prompt=prompt_text,
            revised_prompt=resolved_revised_prompt,
            image_url=resolved_image_url,
            image_data_url=resolved_image_data_url,
        )
        db.add(persisted_image)
        touch_story_game(game)
        db.commit()
        db.refresh(persisted_image)
        db.refresh(user)
    except Exception as exc:
        db.rollback()
        try:
            _add_user_tokens(db, int(user.id), generation_cost)
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            logger.exception("Story map image token refund failed after persistence error: game_id=%s", game.id)
        logger.exception("Story map image persistence failed: game_id=%s scope=%s", game.id, normalized_scope)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Map image generated but failed to persist: {str(exc).strip()[:500] or 'database write failed'}",
        ) from exc

    image_out = _story_map_image_to_out(persisted_image)
    return StoryMapImageGenerateOut(
        **image_out.model_dump(),
        user=UserOut.model_validate(user),
    )

def _latest_location_memory_content(db: Session, *, game_id: int) -> str:
    latest_block = db.scalar(
        select(StoryMemoryBlock)
        .where(
            StoryMemoryBlock.game_id == game_id,
            StoryMemoryBlock.layer == "location",
            StoryMemoryBlock.undone_at.is_(None),
        )
        .order_by(StoryMemoryBlock.id.desc())
        .limit(1)
    )
    if latest_block is None:
        return ""
    return _normalize_multiline_text(latest_block.content, max_length=320)


def _location_candidates_from_payload(payload: StoryMapStateOut) -> dict[str, StoryMapLocationOut]:
    return {location.id: location for location in payload.locations}


def _match_location_from_text(payload: StoryMapStateOut, text_value: str) -> StoryMapLocationOut | None:
    normalized_text = f" {str(text_value or '').casefold()} "
    if len(normalized_text.strip()) < 2:
        return None
    best_match: StoryMapLocationOut | None = None
    best_score = 0
    for location in payload.locations:
        for candidate in [location.name, *(location.aliases or [])]:
            normalized_candidate = _normalize_text(candidate, max_length=160).casefold()
            if len(normalized_candidate) < 3 or normalized_candidate not in normalized_text:
                continue
            score = len(normalized_candidate) * 3 + int(location.importance or 0)
            if re.search(rf"(?<!\w){re.escape(normalized_candidate)}(?!\w)", normalized_text):
                score += 17
            if score > best_score:
                best_score = score
                best_match = location
    return best_match


def _match_poi_from_text(
    payload: StoryMapStateOut,
    text_value: str,
    *,
    location_id: str | None,
) -> StoryMapPoiOut | None:
    normalized_text = f" {str(text_value or '').casefold()} "
    normalized_location_id = _normalize_text(location_id, max_length=48) or None
    if normalized_location_id is None or len(normalized_text.strip()) < 2:
        return None
    best_match: StoryMapPoiOut | None = None
    best_score = 0
    for poi in payload.pois:
        if poi.location_id != normalized_location_id:
            continue
        for candidate in [poi.name, *(poi.aliases or [])]:
            normalized_candidate = _normalize_text(candidate, max_length=160).casefold()
            if len(normalized_candidate) < 4 or normalized_candidate not in normalized_text:
                continue
            score = len(normalized_candidate) * 3 + int(poi.importance or 0)
            if re.search(rf"(?<!\w){re.escape(normalized_candidate)}(?!\w)", normalized_text):
                score += 19
            if score > best_score:
                best_score = score
                best_match = poi
    return best_match


def _build_route_graph(payload: StoryMapStateOut) -> dict[str, list[tuple[str, StoryMapRouteOut]]]:
    graph: dict[str, list[tuple[str, StoryMapRouteOut]]] = {}
    for route in payload.routes:
        graph.setdefault(route.from_location_id, []).append((route.to_location_id, route))
        graph.setdefault(route.to_location_id, []).append((route.from_location_id, route))
    return graph


def _shortest_route_path(payload: StoryMapStateOut, *, from_location_id: str, to_location_id: str) -> list[StoryMapRouteOut] | None:
    if not from_location_id or not to_location_id:
        return None
    if from_location_id == to_location_id:
        return []
    graph = _build_route_graph(payload)
    heap: list[tuple[int, str, list[StoryMapRouteOut]]] = [(0, from_location_id, [])]
    best_cost_by_location: dict[str, int] = {from_location_id: 0}
    while heap:
        cost, current_location_id, path = heappop(heap)
        if current_location_id == to_location_id:
            return path
        for neighbor_location_id, route in graph.get(current_location_id, []):
            next_cost = cost + max(int(route.travel_minutes or 0), 1)
            if next_cost >= best_cost_by_location.get(neighbor_location_id, 10**9):
                continue
            best_cost_by_location[neighbor_location_id] = next_cost
            heappush(heap, (next_cost, neighbor_location_id, [*path, route]))
    return None


def build_story_map_travel_preview(
    *,
    game: StoryGame,
    payload: StoryMapStateOut,
    destination_location_id: str | None,
    destination_poi_id: str | None = None,
) -> StoryMapTravelPreviewOut:
    location_by_id = _location_candidates_from_payload(payload)
    poi_by_id = _story_map_poi_by_id(payload)
    normalized_destination_location_id = _normalize_text(destination_location_id, max_length=48) or None
    normalized_destination_poi_id = _normalize_text(destination_poi_id, max_length=48) or None
    destination_poi = poi_by_id.get(normalized_destination_poi_id or "") if normalized_destination_poi_id else None
    if destination_poi is not None and normalized_destination_location_id is None:
        normalized_destination_location_id = destination_poi.location_id
    destination = location_by_id.get(normalized_destination_location_id or "")
    current_location = location_by_id.get(payload.current_location_id or "") if payload.current_location_id else None
    current_poi = poi_by_id.get(payload.current_poi_id or "") if payload.current_poi_id else None
    weather_multiplier = _weather_multiplier_for_game(game)
    environment_time_enabled = normalize_story_environment_enabled(getattr(game, "environment_enabled", None))

    if destination_poi is not None:
        if destination is None:
            return StoryMapTravelPreviewOut(
                reachable=False,
                destination_location_id=normalized_destination_location_id or "",
                destination_poi_id=normalized_destination_poi_id,
                destination_poi_name=destination_poi.name,
                from_location_id=current_location.id if current_location is not None else None,
                from_location_name=current_location.name if current_location is not None else None,
                from_poi_id=current_poi.id if current_poi is not None else None,
                from_poi_name=current_poi.name if current_poi is not None else "",
                detail="Внутригородская точка не привязана к доступной локации.",
                environment_time_enabled=environment_time_enabled,
                weather_multiplier=weather_multiplier,
                scope="poi",
            )
        if current_location is None or current_location.id != destination.location_id:
            return StoryMapTravelPreviewOut(
                reachable=False,
                destination_location_id=destination.location_id,
                destination_name=destination.name,
                destination_poi_id=destination_poi.id,
                destination_poi_name=destination_poi.name,
                from_location_id=current_location.id if current_location is not None else None,
                from_location_name=current_location.name if current_location is not None else None,
                from_poi_id=current_poi.id if current_poi is not None else None,
                from_poi_name=current_poi.name if current_poi is not None else "",
                detail="Сначала нужно прибыть в эту локацию, а уже потом идти к её точкам интереса.",
                environment_time_enabled=environment_time_enabled,
                weather_multiplier=weather_multiplier,
                scope="poi",
            )
        if current_poi is not None and current_poi.id == destination_poi.id:
            return StoryMapTravelPreviewOut(
                reachable=True,
                destination_location_id=destination.location_id,
                destination_name=destination.name,
                destination_poi_id=destination_poi.id,
                destination_poi_name=destination_poi.name,
                from_location_id=current_location.id,
                from_location_name=current_location.name,
                from_poi_id=current_poi.id,
                from_poi_name=current_poi.name,
                route_ids=[],
                route_steps=[],
                base_travel_minutes=0,
                adjusted_travel_minutes=0,
                weather_multiplier=weather_multiplier,
                environment_time_enabled=environment_time_enabled,
                detail="Эта точка уже активна.",
                scope="poi",
            )
        start_x = current_poi.x if current_poi is not None else current_location.x
        start_y = current_poi.y if current_poi is not None else current_location.y
        base_travel_minutes = max(
            int(round(_story_map_distance(start_x, start_y, destination_poi.x, destination_poi.y) * 0.18)),
            4,
        )
        adjusted_travel_minutes = int(round(base_travel_minutes * weather_multiplier))
        return StoryMapTravelPreviewOut(
            reachable=True,
            destination_location_id=destination.location_id,
            destination_name=destination.name,
            destination_poi_id=destination_poi.id,
            destination_poi_name=destination_poi.name,
            from_location_id=current_location.id,
            from_location_name=current_location.name,
            from_poi_id=current_poi.id if current_poi is not None else None,
            from_poi_name=current_poi.name if current_poi is not None else "",
            route_ids=[],
            route_steps=[],
            base_travel_minutes=base_travel_minutes,
            adjusted_travel_minutes=max(adjusted_travel_minutes, 0),
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            detail="Маршрут внутри локации построен.",
            scope="poi",
        )

    if destination is None:
        return StoryMapTravelPreviewOut(
            reachable=False,
            destination_location_id=normalized_destination_location_id or "",
            detail="Точка назначения не найдена на карте.",
            environment_time_enabled=environment_time_enabled,
        )

    if current_location is None:
        return StoryMapTravelPreviewOut(
            reachable=True,
            destination_location_id=destination.id,
            destination_name=destination.name,
            from_location_id=None,
            from_location_name=None,
            route_ids=[],
            route_steps=[],
            base_travel_minutes=0,
            adjusted_travel_minutes=0,
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            detail="Текущая точка не определена, назначение станет новой опорной позицией.",
            scope="location",
        )

    if current_location.id == destination.id:
        return StoryMapTravelPreviewOut(
            reachable=True,
            destination_location_id=destination.id,
            destination_name=destination.name,
            from_location_id=current_location.id,
            from_location_name=current_location.name,
            route_ids=[],
            route_steps=[],
            base_travel_minutes=0,
            adjusted_travel_minutes=0,
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            detail="Вы уже находитесь в этой точке.",
            scope="location",
        )

    route_path = _shortest_route_path(
        payload,
        from_location_id=current_location.id,
        to_location_id=destination.id,
    )
    if route_path is None:
        return StoryMapTravelPreviewOut(
            reachable=False,
            destination_location_id=destination.id,
            destination_name=destination.name,
            from_location_id=current_location.id,
            from_location_name=current_location.name,
            weather_multiplier=weather_multiplier,
            environment_time_enabled=environment_time_enabled,
            detail="Маршрут к выбранной точке сейчас не построен.",
            scope="location",
        )

    route_steps: list[StoryMapTravelStepOut] = []
    step_from_location_id = current_location.id
    for route in route_path:
        step_to_location_id = route.to_location_id if route.from_location_id == step_from_location_id else route.from_location_id
        from_location = location_by_id.get(step_from_location_id)
        to_location = location_by_id.get(step_to_location_id)
        route_steps.append(
            StoryMapTravelStepOut(
                route_id=route.id,
                from_location_id=step_from_location_id,
                to_location_id=step_to_location_id,
                from_name=from_location.name if from_location is not None else step_from_location_id,
                to_name=to_location.name if to_location is not None else step_to_location_id,
                kind=route.kind,
                travel_minutes=max(int(route.travel_minutes or 0), 0),
            )
        )
        step_from_location_id = step_to_location_id

    base_travel_minutes = sum(step.travel_minutes for step in route_steps)
    adjusted_travel_minutes = int(round(base_travel_minutes * weather_multiplier))
    return StoryMapTravelPreviewOut(
        reachable=True,
        destination_location_id=destination.id,
        destination_name=destination.name,
        from_location_id=current_location.id,
        from_location_name=current_location.name,
        route_ids=[step.route_id for step in route_steps],
        route_steps=route_steps,
        base_travel_minutes=base_travel_minutes,
        adjusted_travel_minutes=max(adjusted_travel_minutes, 0),
        weather_multiplier=weather_multiplier,
        environment_time_enabled=environment_time_enabled,
        detail="Маршрут построен." if route_steps else "Точка уже доступна без перехода по дорогам.",
        scope="location",
    )


def travel_story_map_to_location(
    *,
    game: StoryGame,
    destination_location_id: str,
    destination_poi_id: str | None = None,
) -> StoryMapStateOut:
    payload = story_map_payload_to_out(
        is_enabled=bool(getattr(game, "story_map_enabled", False)),
        raw_payload=str(getattr(game, "story_map_payload", "") or ""),
    )
    if payload is None or not payload.is_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Story map is disabled")

    preview = build_story_map_travel_preview(
        game=game,
        payload=payload,
        destination_location_id=destination_location_id,
        destination_poi_id=destination_poi_id,
    )
    if not preview.reachable:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=preview.detail or "Destination is unreachable")

    location_by_id = _location_candidates_from_payload(payload)
    destination = location_by_id.get(preview.destination_location_id)
    if destination is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Destination was not found on the map")

    if preview.adjusted_travel_minutes > 0:
        _advance_environment_datetime_for_travel(game, travel_minutes=preview.adjusted_travel_minutes)

    if preview.from_location_id and preview.from_location_id != preview.destination_location_id:
        payload.travel_log = [
            StoryMapTravelLogEntryOut.model_validate(entry)
            for entry in _upsert_travel_log_entry(
                payload,
                assistant_message_id=None,
                from_location_id=preview.from_location_id,
                from_location_name=preview.from_location_name or preview.from_location_id,
                to_location_id=preview.destination_location_id,
                to_location_name=preview.destination_name or preview.destination_location_id,
                route_ids=preview.route_ids,
                travel_minutes=preview.adjusted_travel_minutes,
                weather_multiplier=preview.weather_multiplier,
            )
        ]

    payload.current_location_id = destination.id
    payload.current_region_id = destination.region_id
    payload.current_poi_id = preview.destination_poi_id or None
    payload.current_location_label = destination.name
    payload.current_poi_label = preview.destination_poi_name or ""
    payload.last_sync_warning = ""
    payload.updated_at = _utcnow_iso()

    game.story_map_enabled = True
    game.story_map_payload = payload.model_dump_json()
    touch_story_game(game)
    return payload


def _weather_multiplier_for_game(game: StoryGame) -> float:
    if not normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):
        return 1.0
    weather_payload = deserialize_story_environment_weather(str(getattr(game, "environment_current_weather", "") or ""))
    if not isinstance(weather_payload, dict):
        return 1.0
    search_space = " ".join(
        str(weather_payload.get(field_name) or "")
        for field_name in ("summary", "fog", "humidity", "wind")
    ).casefold()
    multiplier = 1.0
    if any(token in search_space for token in ("бур", "storm", "шторм", "метел", "blizzard")):
        multiplier += 0.35
    if any(token in search_space for token in ("дожд", "rain", "лив", "морось")):
        multiplier += 0.18
    if any(token in search_space for token in ("снег", "snow", "лед", "ice")):
        multiplier += 0.22
    if any(token in search_space for token in ("туман", "fog")):
        multiplier += 0.08
    if any(token in search_space for token in ("ветер", "wind")):
        multiplier += 0.06
    return round(multiplier, 2)


def _advance_environment_datetime_for_travel(game: StoryGame, *, travel_minutes: int) -> None:
    if not normalize_story_environment_enabled(getattr(game, "environment_enabled", None)):
        return
    current_datetime = deserialize_story_environment_datetime(str(getattr(game, "environment_current_datetime", "") or ""))
    if current_datetime is None:
        return
    adjusted_minutes = max(int(travel_minutes), 0)
    if adjusted_minutes <= 0:
        return
    game.environment_current_datetime = serialize_story_environment_datetime(current_datetime + timedelta(minutes=adjusted_minutes))


def _upsert_travel_log_entry(
    payload: StoryMapStateOut,
    *,
    assistant_message_id: int | None,
    from_location_id: str,
    from_location_name: str,
    to_location_id: str,
    to_location_name: str,
    route_ids: list[str],
    travel_minutes: int,
    weather_multiplier: float,
) -> list[dict[str, Any]]:
    entries = [entry.model_dump(mode="python") for entry in payload.travel_log]
    if isinstance(assistant_message_id, int) and assistant_message_id > 0:
        entries = [entry for entry in entries if int(entry.get("assistant_message_id") or 0) != assistant_message_id]
    entries.append(
        {
            "assistant_message_id": assistant_message_id,
            "from_location_id": from_location_id,
            "to_location_id": to_location_id,
            "route_ids": route_ids,
            "travel_minutes": max(int(travel_minutes), 0),
            "weather_multiplier": round(max(float(weather_multiplier), 1.0), 2),
            "arrived_at": _utcnow_iso(),
            "summary": f"{from_location_name or from_location_id} -> {to_location_name or to_location_id}",
        }
    )
    return entries[-STORY_MAP_MAX_TRAVEL_LOG:]


def _should_show_political_overlay(*, latest_user_prompt: str, latest_assistant_text: str) -> bool:
    search_space = f"{latest_user_prompt}\n{latest_assistant_text}".casefold()
    return any(token in search_space for token in ("границ", "импер", "королев", "альянс", "state border", "political map"))


def sync_story_map_after_assistant_message(
    *,
    db: Session,
    game: StoryGame,
    assistant_message: StoryMessage | None = None,
    latest_user_prompt: str | None = None,
    latest_assistant_text: str | None = None,
    current_location_content: str | None = None,
) -> bool:
    payload = story_map_payload_to_out(
        is_enabled=bool(getattr(game, "story_map_enabled", False)),
        raw_payload=str(getattr(game, "story_map_payload", "") or ""),
    )
    if payload is None or not payload.is_enabled:
        return False

    resolved_latest_user_prompt = _normalize_multiline_text(latest_user_prompt, max_length=1200)
    resolved_latest_assistant_text = _normalize_multiline_text(latest_assistant_text, max_length=2400)
    resolved_location_content = _normalize_multiline_text(
        current_location_content or _latest_location_memory_content(db, game_id=game.id),
        max_length=320,
    )
    matched_location = _match_location_from_text(payload, resolved_location_content)
    if matched_location is None and resolved_latest_assistant_text:
        matched_location = _match_location_from_text(payload, resolved_latest_assistant_text)
    if matched_location is None and resolved_latest_user_prompt:
        matched_location = _match_location_from_text(payload, resolved_latest_user_prompt)
    poi_location_id = matched_location.id if matched_location is not None else (payload.current_location_id or None)
    matched_poi = _match_poi_from_text(payload, resolved_location_content, location_id=poi_location_id)
    if matched_poi is None and resolved_latest_assistant_text:
        matched_poi = _match_poi_from_text(payload, resolved_latest_assistant_text, location_id=poi_location_id)
    if matched_poi is None and resolved_latest_user_prompt:
        matched_poi = _match_poi_from_text(payload, resolved_latest_user_prompt, location_id=poi_location_id)

    changed = False
    next_overlay_mode = STORY_MAP_OVERLAY_POLITICAL if _should_show_political_overlay(
        latest_user_prompt=resolved_latest_user_prompt,
        latest_assistant_text=resolved_latest_assistant_text,
    ) else payload.overlay_mode
    if next_overlay_mode != payload.overlay_mode:
        payload.overlay_mode = next_overlay_mode
        changed = True

    if matched_location is not None:
        previous_location_id = payload.current_location_id or ""
        next_location_id = matched_location.id
        if next_location_id != previous_location_id:
            route_path = _shortest_route_path(
                payload,
                from_location_id=previous_location_id,
                to_location_id=next_location_id,
            ) if previous_location_id else []
            if route_path is None and previous_location_id:
                next_warning = f"Переход {previous_location_id} -> {next_location_id} выпал вне дорожной сети."[:240]
                if payload.last_sync_warning != next_warning:
                    payload.last_sync_warning = next_warning
                    changed = True
            else:
                payload.last_sync_warning = ""
                base_travel_minutes = sum(max(int(route.travel_minutes or 0), 0) for route in route_path or [])
                weather_multiplier = _weather_multiplier_for_game(game)
                adjusted_travel_minutes = int(round(base_travel_minutes * weather_multiplier))
                location_candidates = _location_candidates_from_payload(payload)
                from_location = location_candidates.get(previous_location_id or next_location_id)
                if adjusted_travel_minutes > 0:
                    _advance_environment_datetime_for_travel(game, travel_minutes=adjusted_travel_minutes)
                payload.travel_log = [
                    StoryMapTravelLogEntryOut.model_validate(entry)
                    for entry in _upsert_travel_log_entry(
                        payload,
                        assistant_message_id=int(assistant_message.id) if isinstance(assistant_message, StoryMessage) else None,
                        from_location_id=previous_location_id or next_location_id,
                        from_location_name=from_location.name if from_location is not None else (previous_location_id or next_location_id),
                        to_location_id=next_location_id,
                        to_location_name=matched_location.name,
                        route_ids=[route.id for route in route_path or []],
                        travel_minutes=adjusted_travel_minutes,
                        weather_multiplier=weather_multiplier,
                    )
                ]
                payload.current_location_id = next_location_id
                payload.current_location_label = matched_location.name
                payload.current_region_id = matched_location.region_id
                payload.current_poi_id = None
                payload.current_poi_label = ""
                changed = True
        else:
            if payload.last_sync_warning:
                payload.last_sync_warning = ""
                changed = True
            if payload.current_location_label != matched_location.name:
                payload.current_location_label = matched_location.name
                changed = True
            if payload.current_region_id != matched_location.region_id:
                payload.current_region_id = matched_location.region_id
                changed = True
    elif payload.last_sync_warning:
        payload.last_sync_warning = ""
        changed = True

    if matched_poi is not None:
        if payload.current_poi_id != matched_poi.id:
            payload.current_poi_id = matched_poi.id
            changed = True
        if payload.current_poi_label != matched_poi.name:
            payload.current_poi_label = matched_poi.name
            changed = True
    elif matched_location is not None:
        if payload.current_poi_id is not None:
            payload.current_poi_id = None
            changed = True
        if payload.current_poi_label:
            payload.current_poi_label = ""
            changed = True

    if changed:
        payload.updated_at = _utcnow_iso()
        game.story_map_enabled = True
        game.story_map_payload = payload.model_dump_json()
    return changed


def build_story_map_prompt_card(game: StoryGame) -> dict[str, str] | None:
    payload = story_map_payload_to_out(
        is_enabled=bool(getattr(game, "story_map_enabled", False)),
        raw_payload=str(getattr(game, "story_map_payload", "") or ""),
    )
    if payload is None or not payload.is_enabled or not payload.locations:
        return None

    location_by_id = _location_candidates_from_payload(payload)
    region_by_id = {region.id: region for region in payload.regions}
    current_location = location_by_id.get(payload.current_location_id or "") if payload.current_location_id else None
    current_region = region_by_id.get(current_location.region_id or "") if current_location is not None else None
    current_poi = _story_map_poi_by_id(payload).get(payload.current_poi_id or "") if payload.current_poi_id else None
    nearby_poi_lines = [
        f"- {poi.name}: {STORY_MAP_POI_KIND_LABELS_RU.get(poi.kind, poi.kind)}."
        for poi in _story_map_focus_pois_for_location(
            payload,
            location_id=current_location.id if current_location is not None else None,
            limit=8,
        )
    ]

    adjacent_route_lines: list[str] = []
    for route in payload.routes:
        if current_location is None:
            break
        if route.from_location_id != current_location.id and route.to_location_id != current_location.id:
            continue
        other_location_id = route.to_location_id if route.from_location_id == current_location.id else route.from_location_id
        other_location = location_by_id.get(other_location_id)
        if other_location is None:
            continue
        adjacent_route_lines.append(
            f"- {other_location.name}: {_route_label_ru(route.kind)}, ~{max(int(route.travel_minutes or 0), 0)} мин."
        )
    if not adjacent_route_lines:
        adjacent_route_lines.append("- Из текущей точки нет разрешенного прямого выхода без явной сцены дороги.")

    region_lines = [
        f"- {region.name}: {STORY_MAP_REGION_KIND_LABELS_RU.get(region.kind, 'регион')}."
        for region in payload.regions[:4]
    ]
    location_lines = [
        f"- {location.name}: {STORY_MAP_LOCATION_KIND_LABELS_RU.get(location.kind, location.kind)}."
        for location in sorted(payload.locations, key=lambda item: int(item.importance or 0), reverse=True)[:16]
    ]
    content_lines = [
        f"Current map theme: {payload.theme}.",
        f"Current world start anchor: {payload.start_location}.",
        f"Current player map position: {current_location.name if current_location is not None else payload.current_location_label or 'unknown'}.",
        f"Current local anchor inside the active location: {current_poi.name if current_poi is not None else payload.current_poi_label or 'not specified'}.",
        f"Тема мира: {payload.theme}.",
        f"Стартовая локация карты: {payload.start_location}.",
        f"Текущая позиция ГГ: {current_location.name if current_location is not None else payload.current_location_label or 'неизвестна'}.",
        f"Текущий политический регион: {current_region.name if current_region is not None else 'не уточнен'}.",
        "ПРАВИЛО КАРТЫ: ГГ нельзя мгновенно переносить в известный город или регион без существующего маршрута, цепочки маршрутов или явной сцены дороги.",
        "Если игрок просит показать границы государств, используй уже существующие регионы карты и не выдумывай новую политическую географию без причины.",
        "Доступные маршруты из текущей точки:",
        *adjacent_route_lines[:8],
        "Current in-location anchors:",
        *(nearby_poi_lines or ["- No in-location anchors are mapped yet."]),
        "Главные регионы карты:",
        *region_lines,
        "Известные опорные точки карты:",
        *location_lines,
    ]
    return {
        "title": "Карта мира: Навигация и границы",
        "content": "\n".join(line for line in content_lines if line).strip(),
    }
