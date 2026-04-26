import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import BaseDialog from '../dialogs/BaseDialog'
import { createQuickStartStoryGame } from '../../services/storyApi'
import type { StoryGameSummary } from '../../types/story'

type QuickStartWizardDialogProps = {
  open: boolean
  authToken: string
  onClose: () => void
  onStarted: (game: StoryGameSummary) => void
}

type QuickStartMode = 'calm' | 'action'

type QuickStartClassOption = {
  id: string
  label: string
  description: string
}

type QuickStartGenreOption = {
  id: string
  label: string
  description: string
  classes: QuickStartClassOption[]
}

const PROTAGONIST_NAME_MAX = 120

function createClass(id: string, label: string, description: string): QuickStartClassOption {
  return { id, label, description }
}

const QUICK_START_GENRES: QuickStartGenreOption[] = [
  {
    id: 'fantasy',
    label: 'Фэнтези',
    description: 'Королевства, магия, древние артефакты и героические походы.',
    classes: [
      createClass('knight', 'Рыцарь', 'Тяжёлая броня, честь и передовая.'),
      createClass('mage', 'Маг', 'Заклинания, тайные школы и реликвии.'),
      createClass('ranger', 'Следопыт', 'Лесные тропы, звери и меткий выстрел.'),
      createClass('priest', 'Жрец', 'Свет, ритуалы и защита союзников.'),
      createClass('assassin', 'Ассасин', 'Тени, клинки и точечные удары.'),
      createClass('bard', 'Бард', 'Харизма, песни и влияние на толпу.'),
      createClass('alchemist', 'Алхимик', 'Эликсиры, дым и опасные смеси.'),
      createClass('summoner', 'Призыватель', 'Контракты с существами иных планов.'),
      createClass('beastmaster', 'Укротитель', 'Связь со зверями и природой.'),
      createClass('heir', 'Изгнанный наследник', 'Кровь трона и право на возвращение.'),
    ],
  },
  {
    id: 'dark-fantasy',
    label: 'Тёмное фэнтези',
    description: 'Проклятия, кровь, серая мораль и красота на краю гибели.',
    classes: [
      createClass('witch-hunter', 'Охотник на ведьм', 'Сталь, серебро и холодная вера.'),
      createClass('cursed-blade', 'Проклятый клинок', 'Оружие шепчет и требует цену.'),
      createClass('necromancer', 'Некромант', 'Мёртвые отвечают только тебе.'),
      createClass('inquisitor', 'Инквизитор', 'Закон, костры и жёсткий порядок.'),
      createClass('vampire', 'Вампирский дворянин', 'Манеры, голод и вечная ночь.'),
      createClass('plague-doctor', 'Чумной доктор', 'Маска, настойки и страшные тайны.'),
      createClass('gravekeeper', 'Хранитель могил', 'Страж между миром живых и мёртвых.'),
      createClass('demon-pact', 'Носитель пакта', 'Сила демона и тонкая грань контроля.'),
      createClass('fallen-paladin', 'Падший паладин', 'Разбитые клятвы и всё ещё острый меч.'),
      createClass('crow-scout', 'Ворон-разведчик', 'Тени городов и дурные вести.'),
    ],
  },
  {
    id: 'sci-fi',
    label: 'Научная фантастика',
    description: 'Космос, технологии, чужие цивилизации и огромные ставки.',
    classes: [
      createClass('pilot', 'Пилот', 'Манёвры, риск и собственный корабль.'),
      createClass('marine', 'Космодесантник', 'Дисциплина, броня и огонь по приказу.'),
      createClass('engineer', 'Инженер', 'Дроны, системы и невозможные ремонты.'),
      createClass('xenobiologist', 'Ксенобиолог', 'Чужая жизнь и опасное любопытство.'),
      createClass('android', 'Андроид', 'Идеальная логика и растущая человечность.'),
      createClass('psionic', 'Псионик', 'Разум как оружие и дар.'),
      createClass('smuggler', 'Контрабандист', 'Тёмные маршруты и нужные связи.'),
      createClass('bounty-hunter', 'Охотник за наградой', 'Контракты, метки и репутация.'),
      createClass('diplomat', 'Дипломат', 'Слова решают войны не хуже флота.'),
      createClass('chronist', 'Хронист времени', 'Аномалии, хроники и последствия выбора.'),
    ],
  },
  {
    id: 'cyberpunk',
    label: 'Киберпанк',
    description: 'Неон, корпорации, импланты и города, которые не спят.',
    classes: [
      createClass('netrunner', 'Нэтраннер', 'Взлом, сети и атака изнутри.'),
      createClass('street-samurai', 'Стрит-самурай', 'Импланты, клинок и улица как арена.'),
      createClass('techie', 'Технарь', 'Железо, дроны и сборка из хлама.'),
      createClass('fixer', 'Фиксер', 'Контакты, сделки и грязные поручения.'),
      createClass('corp-defector', 'Перебежчик корпорации', 'Ты знаешь слишком много.'),
      createClass('combat-medic', 'Боевой медик', 'Стимы, шрамы и спасение под огнём.'),
      createClass('drone-master', 'Оператор дронов', 'Рой машин и обзор сверху.'),
      createClass('aug-detective', 'Ауг-детектив', 'Сканеры, улики и цифровая память.'),
      createClass('courier', 'Курьер нулевого уровня', 'Одна доставка меняет весь район.'),
      createClass('idol-hacker', 'Идол-хакер', 'Сцена днём, саботаж ночью.'),
    ],
  },
  {
    id: 'horror',
    label: 'Хоррор',
    description: 'Тревога, неизвестность и истории, которые лучше не рассказывать вслух.',
    classes: [
      createClass('medium', 'Медиум', 'Ты слышишь тех, кого забыли.'),
      createClass('survivor', 'Выживший', 'Ты уже видел ужас и помнишь его.'),
      createClass('occultist', 'Оккультист', 'Запретные книги и холодная логика.'),
      createClass('exorcist', 'Экзорцист', 'Ритуалы, вера и изгнание тьмы.'),
      createClass('monster-hunter', 'Охотник на чудовищ', 'Снаряжение, опыт и крепкие нервы.'),
      createClass('dreamwalker', 'Сноходец', 'Кошмары становятся дорогой.'),
      createClass('investigator', 'Следователь пропавших', 'Ты ищешь людей там, где пусто.'),
      createClass('cursed-heir', 'Проклятый наследник', 'Старый род и старый голод внутри.'),
      createClass('chapel-keeper', 'Хранитель часовни', 'Тихая служба и древние печати.'),
      createClass('ritual-artist', 'Художник ритуалов', 'Символы, краски и живые картины.'),
    ],
  },
  {
    id: 'post-apocalypse',
    label: 'Постапокалипсис',
    description: 'Пыль, руины, дефицит и цена каждого решения.',
    classes: [
      createClass('scout', 'Разведчик', 'Пустошь говорит только с внимательными.'),
      createClass('scrapper', 'Скраппер', 'Новая жизнь из обломков мира.'),
      createClass('guard', 'Караванный страж', 'Сопровождение туда, где шансов нет.'),
      createClass('mutant', 'Мутант', 'Твоё тело пережило катастрофу.'),
      createClass('field-medic', 'Полевой медик', 'Повязки, стимы и последние шансы.'),
      createClass('mechanic', 'Механик', 'Двигатели, броня и ремонт на коленке.'),
      createClass('stalker', 'Сталкер руин', 'Ты ходишь туда, куда не возвращаются.'),
      createClass('beast-rider', 'Всадник пустошей', 'Скорость, пыль и дикий зверь.'),
      createClass('warlord-heir', 'Наследник банды', 'Власть по крови и силе.'),
      createClass('prophet', 'Радиант-пророк', 'Сияние шепчет тебе о будущем.'),
    ],
  },
  {
    id: 'school-anime',
    label: 'Школьное аниме',
    description: 'Повседневность, дружба, клубы, секреты и магия за углом.',
    classes: [
      createClass('transfer', 'Новенький', 'Первый день и слишком странная школа.'),
      createClass('council', 'Звезда студсовета', 'Влияние, дисциплина и тайный график.'),
      createClass('club-captain', 'Капитан клуба', 'Команда ждёт от тебя невозможного.'),
      createClass('delinquent', 'Бунтарь', 'Улицы, репутация и скрытая мягкость.'),
      createClass('idol', 'Школьный идол', 'Сцена, фанаты и двойная жизнь.'),
      createClass('occult-girl', 'Оккультный исследователь', 'Шкафы, печати и запретные комнаты.'),
      createClass('sports-ace', 'Спортивная звезда', 'Соревнования и давление ожиданий.'),
      createClass('genius', 'Гений класса', 'Мозг, холод и неожиданные чувства.'),
      createClass('shrine-keeper', 'Хранитель святилища', 'Родовая тайна и долг семьи.'),
      createClass('time-traveler', 'Путешественник во времени', 'Ты уже видел этот день раньше.'),
    ],
  },
  {
    id: 'detective',
    label: 'Детектив',
    description: 'Улики, допросы, заговоры и правда, за которую придётся платить.',
    classes: [
      createClass('private-eye', 'Частный сыщик', 'Интуиция, наблюдательность и старые долги.'),
      createClass('forensic', 'Криминалист', 'Наука, детали и холодные выводы.'),
      createClass('reporter', 'Репортёр', 'Истории, инсайды и опасные источники.'),
      createClass('inspector', 'Инспектор', 'Закон, сеть информаторов и давление сверху.'),
      createClass('thief', 'Карманник', 'Ты видишь то, что другим не дано.'),
      createClass('lawyer', 'Адвокат', 'Слова, логика и игра на нервах.'),
      createClass('psychologist', 'Профайлер', 'Люди читаются как страницы дела.'),
      createClass('bodyguard', 'Телохранитель', 'Кулаки, дисциплина и своя этика.'),
      createClass('hacker', 'Сетевой аналитик', 'Цифровые следы и скрытые архивы.'),
      createClass('retired-agent', 'Бывший агент', 'Прошлое не хочет тебя отпускать.'),
    ],
  },
  {
    id: 'mythology',
    label: 'Мифология',
    description: 'Боги, пророчества, чудовища и судьба, записанная в звёздах.',
    classes: [
      createClass('demigod', 'Полубог', 'Божественная кровь и земная слабость.'),
      createClass('oracle', 'Оракул', 'Видения правдивы, но цена растёт.'),
      createClass('guardian', 'Страж храма', 'Долг древнее твоего имени.'),
      createClass('skald', 'Рунный скальд', 'Песни и руны меняют судьбу.'),
      createClass('moon-archer', 'Лунный лучник', 'Тишина, дистанция и небесная охота.'),
      createClass('sun-priest', 'Жрец солнца', 'Свет умеет и лечить, и карать.'),
      createClass('storm-raider', 'Штормовой рейдер', 'Море, буря и смелость саг.'),
      createClass('beast-keeper', 'Хранитель зверей', 'Священные существа знают твою душу.'),
      createClass('divine-smith', 'Божественный кузнец', 'Ты создаёшь вещи для легенд.'),
      createClass('lost-heir', 'Потерянный наследник пантеона', 'Твоё происхождение меняет порядок мира.'),
    ],
  },
  {
    id: 'romance-adventure',
    label: 'Романтическое приключение',
    description: 'Путешествие, чувства, выбор между сердцем и долгом.',
    classes: [
      createClass('duelist', 'Дуэлянт', 'Красивый риск и точный выпад.'),
      createClass('courtier', 'Придворный интриган', 'Вежливость как оружие и маска.'),
      createClass('healer', 'Целитель', 'Мягкая сила и стойкость сердца.'),
      createClass('spy', 'Шпион', 'Секреты, роли и опасная близость.'),
      createClass('captain', 'Капитан', 'Команда, маршрут и штормы.'),
      createClass('merchant', 'Купец-путешественник', 'Сделки, дороги и встречи судьбы.'),
      createClass('noble', 'Благородный изгнанник', 'Потерянный статус и шанс вернуть больше.'),
      createClass('scholar', 'Учёный романтик', 'Карты, книги и упрямое сердце.'),
      createClass('dancer', 'Танцовщица судьбы', 'Сцена, грация и опасные обещания.'),
      createClass('flower-knight', 'Цветочный рыцарь', 'Красота и сталь в одном движении.'),
    ],
  },
]

const QUICK_START_MODES: Array<{ id: QuickStartMode; title: string; description: string }> = [
  {
    id: 'calm',
    title: 'Спокойный старт',
    description: 'Сначала атмосфера, знакомство с миром и мягкий вход в сюжет.',
  },
  {
    id: 'action',
    title: 'В гущу событий',
    description: 'История стартует сразу в конфликте, опасности или напряжённой сцене.',
  },
]

function QuickStartWizardDialog({ open, authToken, onClose, onStarted }: QuickStartWizardDialogProps) {
  const [step, setStep] = useState(0)
  const [selectedGenreId, setSelectedGenreId] = useState(QUICK_START_GENRES[0].id)
  const [selectedClassId, setSelectedClassId] = useState(QUICK_START_GENRES[0].classes[0].id)
  const [protagonistName, setProtagonistName] = useState('')
  const [startMode, setStartMode] = useState<QuickStartMode>('calm')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const selectedGenre = useMemo(
    () => QUICK_START_GENRES.find((item) => item.id === selectedGenreId) ?? QUICK_START_GENRES[0],
    [selectedGenreId],
  )
  const selectedClass = useMemo(
    () => selectedGenre.classes.find((item) => item.id === selectedClassId) ?? selectedGenre.classes[0],
    [selectedClassId, selectedGenre],
  )

  const canGoNext =
    (step === 0 && Boolean(selectedGenre)) ||
    (step === 1 && Boolean(selectedClass)) ||
    (step === 2 && protagonistName.trim().length > 0) ||
    step === 3

  useEffect(() => {
    if (!open) {
      setStep(0)
      setSelectedGenreId(QUICK_START_GENRES[0].id)
      setSelectedClassId(QUICK_START_GENRES[0].classes[0].id)
      setProtagonistName('')
      setStartMode('calm')
      setIsSubmitting(false)
      setErrorMessage('')
    }
  }, [open])

  useEffect(() => {
    if (!selectedGenre.classes.some((item) => item.id === selectedClassId)) {
      setSelectedClassId(selectedGenre.classes[0].id)
    }
  }, [selectedClassId, selectedGenre])

  const handleStart = async () => {
    if (isSubmitting) {
      return
    }

    setErrorMessage('')
    setIsSubmitting(true)
    try {
      const game = await createQuickStartStoryGame({
        token: authToken,
        genre: selectedGenre.label,
        hero_class: selectedClass.label,
        protagonist_name: protagonistName.trim(),
        start_mode: startMode,
      })
      onStarted(game)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Не удалось запустить быстрый старт'
      setErrorMessage(detail)
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderStep = () => {
    if (step === 0) {
      return (
        <Box
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          }}
        >
          {QUICK_START_GENRES.map((genre) => {
            const isSelected = genre.id === selectedGenreId
            return (
              <ButtonBase
                key={genre.id}
                onClick={() => {
                  setSelectedGenreId(genre.id)
                  setSelectedClassId(genre.classes[0].id)
                }}
                sx={{
                  borderRadius: '16px',
                  border: `var(--morius-border-width) solid ${
                    isSelected ? 'color-mix(in srgb, var(--morius-accent) 58%, var(--morius-card-border))' : 'var(--morius-card-border)'
                  }`,
                  backgroundColor: isSelected ? 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))' : 'var(--morius-card-bg)',
                  p: 1.2,
                  textAlign: 'left',
                  justifyContent: 'flex-start',
                  alignItems: 'stretch',
                  '&:hover': {
                    backgroundColor: 'transparent',
                  },
                }}
              >
                <Stack spacing={0.55}>
                  <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: 'var(--morius-text-primary)' }}>
                    {genre.label}
                  </Typography>
                  <Typography sx={{ fontSize: '0.88rem', lineHeight: 1.45, color: 'var(--morius-text-secondary)' }}>
                    {genre.description}
                  </Typography>
                </Stack>
              </ButtonBase>
            )
          })}
        </Box>
      )
    }

    if (step === 1) {
      return (
        <Box
          sx={{
            display: 'grid',
            gap: 1,
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          }}
        >
          {selectedGenre.classes.map((genreClass) => {
            const isSelected = genreClass.id === selectedClassId
            return (
              <ButtonBase
                key={genreClass.id}
                onClick={() => setSelectedClassId(genreClass.id)}
                sx={{
                  borderRadius: '16px',
                  border: `var(--morius-border-width) solid ${
                    isSelected ? 'color-mix(in srgb, var(--morius-accent) 58%, var(--morius-card-border))' : 'var(--morius-card-border)'
                  }`,
                  backgroundColor: isSelected ? 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))' : 'var(--morius-card-bg)',
                  p: 1.2,
                  textAlign: 'left',
                  justifyContent: 'flex-start',
                  alignItems: 'stretch',
                  '&:hover': {
                    backgroundColor: 'transparent',
                  },
                }}
              >
                <Stack spacing={0.55}>
                  <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: 'var(--morius-text-primary)' }}>
                    {genreClass.label}
                  </Typography>
                  <Typography sx={{ fontSize: '0.88rem', lineHeight: 1.45, color: 'var(--morius-text-secondary)' }}>
                    {genreClass.description}
                  </Typography>
                </Stack>
              </ButtonBase>
            )
          })}
        </Box>
      )
    }

    if (step === 2) {
      return (
        <Stack spacing={1.2}>
          <Typography sx={{ color: 'var(--morius-text-secondary)', lineHeight: 1.5 }}>
            Имя героя будет использоваться в описании персонажа, стартовой сцене и вступительном тексте.
          </Typography>
          <TextField
            autoFocus
            label="Имя главного героя"
            value={protagonistName}
            onChange={(event) => setProtagonistName(event.target.value.slice(0, PROTAGONIST_NAME_MAX))}
            inputProps={{ maxLength: PROTAGONIST_NAME_MAX }}
            placeholder="Например: Акира Найтрейн"
            fullWidth
          />
        </Stack>
      )
    }

    return (
      <Stack spacing={1}>
        {QUICK_START_MODES.map((mode) => {
          const isSelected = mode.id === startMode
          return (
            <ButtonBase
              key={mode.id}
              onClick={() => setStartMode(mode.id)}
              sx={{
                borderRadius: '16px',
                border: `var(--morius-border-width) solid ${
                  isSelected ? 'color-mix(in srgb, var(--morius-accent) 58%, var(--morius-card-border))' : 'var(--morius-card-border)'
                }`,
                backgroundColor: isSelected ? 'color-mix(in srgb, var(--morius-accent) 14%, var(--morius-card-bg))' : 'var(--morius-card-bg)',
                p: 1.2,
                textAlign: 'left',
                justifyContent: 'flex-start',
                alignItems: 'stretch',
                '&:hover': {
                  backgroundColor: 'transparent',
                },
              }}
            >
              <Stack spacing={0.55}>
                <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: 'var(--morius-text-primary)' }}>{mode.title}</Typography>
                <Typography sx={{ fontSize: '0.88rem', lineHeight: 1.45, color: 'var(--morius-text-secondary)' }}>
                  {mode.description}
                </Typography>
              </Stack>
            </ButtonBase>
          )
        })}

        <Box
          sx={{
            mt: 0.5,
            px: 0.05,
            py: 0.08,
            backgroundColor: 'transparent',
          }}
        >
          <Stack spacing={0.35}>
            <Typography sx={{ fontWeight: 800, color: 'var(--morius-text-primary)' }}>Итог</Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem' }}>
              {selectedGenre.label} • {selectedClass.label} • {protagonistName.trim() || 'Без имени'} •{' '}
              {startMode === 'calm' ? 'спокойный старт' : 'в гущу событий'}
            </Typography>
          </Stack>
        </Box>
      </Stack>
    )
  }

  return (
    <BaseDialog
      open={open}
      onClose={() => {
        if (!isSubmitting) {
          onClose()
        }
      }}
      maxWidth="md"
      header={
        <Stack spacing={0.45}>
          <Typography sx={{ fontSize: '1.28rem', fontWeight: 900 }}>Быстрый старт</Typography>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem' }}>
            Выберите жанр, класс, имя героя и тон старта. Дальше ИИ сам соберёт героя и вступительную сцену.
          </Typography>
        </Stack>
      }
      contentSx={{ px: { xs: 1.2, sm: 1.6 }, pb: { xs: 1.2, sm: 1.6 } }}
      actions={({ requestClose }) => (
        <Stack direction="row" spacing={0.8} sx={{ width: '100%', justifyContent: 'space-between' }}>
          <Button
            onClick={step === 0 ? requestClose : () => setStep((current) => Math.max(0, current - 1))}
            disabled={isSubmitting}
            sx={{
              minHeight: 40,
              borderRadius: '12px',
              color: 'var(--morius-text-secondary)',
            }}
          >
            {step === 0 ? 'Закрыть' : 'Назад'}
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => setStep((current) => Math.min(3, current + 1))}
              disabled={!canGoNext || isSubmitting}
              sx={{
                minHeight: 40,
                borderRadius: '12px',
                px: 1.4,
                backgroundColor: 'var(--morius-button-active)',
                color: 'var(--morius-text-primary)',
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                },
              }}
            >
              Далее
            </Button>
          ) : (
            <Button
              onClick={() => void handleStart()}
              disabled={isSubmitting}
              sx={{
                minHeight: 40,
                borderRadius: '12px',
                px: 1.5,
                backgroundColor: 'var(--morius-button-active)',
                color: 'var(--morius-text-primary)',
                '&:hover': {
                  backgroundColor: 'var(--morius-button-hover)',
                },
              }}
            >
              {isSubmitting ? (
                <Stack direction="row" spacing={0.8} alignItems="center">
                  <CircularProgress size={18} sx={{ color: 'currentColor' }} />
                  <span>Создаём мир</span>
                </Stack>
              ) : (
                'Начать'
              )}
            </Button>
          )}
        </Stack>
      )}
    >
      <Stack spacing={1.2}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 0.6,
          }}
        >
          {['Жанр', 'Класс', 'Имя', 'Старт'].map((label, index) => {
            const isActive = index === step
            const isCompleted = index < step
            return (
              <Box
                key={label}
                sx={{
                  minHeight: 10,
                  borderRadius: '999px',
                  backgroundColor:
                    isActive || isCompleted
                      ? 'color-mix(in srgb, var(--morius-accent) 72%, transparent)'
                      : 'color-mix(in srgb, var(--morius-card-border) 80%, transparent)',
                }}
              />
            )
          })}
        </Box>

        {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
        {renderStep()}
      </Stack>
    </BaseDialog>
  )
}

export default QuickStartWizardDialog
