/**
 * The templates Nilo comes with, as Notion's gallery: pages written as
 * Markdown and made through the page import (`POST /pages/import`), and
 * databases made with their properties (`POST /databases`). Written in the
 * member's language; a template is copied once and is theirs to change.
 */
import type { DatabaseSchema, SelectColor, SelectOption } from '@/lib/types/databases';

export type TemplateLocale = 'en' | 'es';

interface Words {
  title: string;
  description: string;
}

interface PageTemplate {
  kind: 'page';
  key: string;
  icon: string;
  words: Record<TemplateLocale, Words & { markdown: string }>;
}

interface DatabaseTemplate {
  kind: 'database';
  key: string;
  icon: string;
  words: Record<TemplateLocale, Words & { schema: DatabaseSchema }>;
  /** A board grouped by this property, besides the table. */
  board?: { name: Record<TemplateLocale, string>; groupBy: string };
}

export type BuiltInTemplate = PageTemplate | DatabaseTemplate;

/** Options without ids: the server gives each one when the database is made. */
const options = (...names: [string, SelectColor][]) =>
  names.map(([name, color]) => ({ name, color }) as SelectOption);

export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  {
    kind: 'page',
    key: 'meeting-notes',
    icon: '📝',
    words: {
      en: {
        title: 'Meeting notes',
        description: 'Agenda, notes, decisions and action items.',
        markdown: `## Details
- **Date:**
- **Attendees:**

## Agenda
1.

## Notes
-

## Decisions
-

## Action items
- [ ]
`,
      },
      es: {
        title: 'Notas de reunión',
        description: 'Orden del día, notas, decisiones y tareas.',
        markdown: `## Detalles
- **Fecha:**
- **Asistentes:**

## Orden del día
1.

## Notas
-

## Decisiones
-

## Tareas
- [ ]
`,
      },
    },
  },
  {
    kind: 'page',
    key: 'weekly-plan',
    icon: '🗓️',
    words: {
      en: {
        title: 'Weekly plan',
        description: 'Goals for the week and a list for each day.',
        markdown: `## Goals this week
- [ ]

## Monday
- [ ]

## Tuesday
- [ ]

## Wednesday
- [ ]

## Thursday
- [ ]

## Friday
- [ ]

## Notes
`,
      },
      es: {
        title: 'Plan semanal',
        description: 'Objetivos de la semana y una lista para cada día.',
        markdown: `## Objetivos de la semana
- [ ]

## Lunes
- [ ]

## Martes
- [ ]

## Miércoles
- [ ]

## Jueves
- [ ]

## Viernes
- [ ]

## Notas
`,
      },
    },
  },
  {
    kind: 'page',
    key: 'project-brief',
    icon: '🚀',
    words: {
      en: {
        title: 'Project brief',
        description: 'Why, what, who and when, on one page.',
        markdown: `## Summary
What this project is, in two sentences.

## Problem
What is not working today, and for whom.

## Goals
-

## Non-goals
-

## Plan
| Milestone | Owner | Date |
| --- | --- | --- |
|  |  |  |

## Risks and open questions
-
`,
      },
      es: {
        title: 'Resumen de proyecto',
        description: 'Por qué, qué, quién y cuándo, en una página.',
        markdown: `## Resumen
Qué es este proyecto, en dos frases.

## Problema
Qué no funciona hoy, y para quién.

## Objetivos
-

## Fuera de alcance
-

## Plan
| Hito | Responsable | Fecha |
| --- | --- | --- |
|  |  |  |

## Riesgos y preguntas abiertas
-
`,
      },
    },
  },
  {
    kind: 'page',
    key: 'todo-list',
    icon: '✅',
    words: {
      en: {
        title: 'To-do list',
        description: 'A simple checklist, by priority.',
        markdown: `## Today
- [ ]

## This week
- [ ]

## Someday
- [ ]
`,
      },
      es: {
        title: 'Lista de tareas',
        description: 'Una lista sencilla, por prioridad.',
        markdown: `## Hoy
- [ ]

## Esta semana
- [ ]

## Algún día
- [ ]
`,
      },
    },
  },
  {
    kind: 'database',
    key: 'task-tracker',
    icon: '🎯',
    board: { name: { en: 'Board', es: 'Tablero' }, groupBy: 'status' },
    words: {
      en: {
        title: 'Task tracker',
        description: 'Tasks with status, owner, due date and priority, as a table and a board.',
        schema: {
          properties: [
            { id: 'name', name: 'Task', type: 'text' },
            {
              id: 'status',
              name: 'Status',
              type: 'status',
              config: {
                options: options(
                  ['Not started', 'gray'],
                  ['In progress', 'blue'],
                  ['Done', 'green'],
                ),
              },
            },
            { id: 'assignee', name: 'Assignee', type: 'person' },
            { id: 'due', name: 'Due', type: 'date' },
            {
              id: 'priority',
              name: 'Priority',
              type: 'select',
              config: { options: options(['High', 'red'], ['Medium', 'yellow'], ['Low', 'gray']) },
            },
          ],
        },
      },
      es: {
        title: 'Seguimiento de tareas',
        description: 'Tareas con estado, responsable, fecha y prioridad, en tabla y tablero.',
        schema: {
          properties: [
            { id: 'name', name: 'Tarea', type: 'text' },
            {
              id: 'status',
              name: 'Estado',
              type: 'status',
              config: {
                options: options(['Sin empezar', 'gray'], ['En curso', 'blue'], ['Hecha', 'green']),
              },
            },
            { id: 'assignee', name: 'Responsable', type: 'person' },
            { id: 'due', name: 'Fecha', type: 'date' },
            {
              id: 'priority',
              name: 'Prioridad',
              type: 'select',
              config: { options: options(['Alta', 'red'], ['Media', 'yellow'], ['Baja', 'gray']) },
            },
          ],
        },
      },
    },
  },
  {
    kind: 'database',
    key: 'reading-list',
    icon: '📚',
    words: {
      en: {
        title: 'Reading list',
        description: 'Books and articles, by type, status and rating.',
        schema: {
          properties: [
            { id: 'name', name: 'Title', type: 'text' },
            {
              id: 'type',
              name: 'Type',
              type: 'select',
              config: {
                options: options(['Book', 'blue'], ['Article', 'purple'], ['Podcast', 'orange']),
              },
            },
            {
              id: 'status',
              name: 'Status',
              type: 'status',
              config: {
                options: options(['To read', 'gray'], ['Reading', 'blue'], ['Finished', 'green']),
              },
            },
            { id: 'author', name: 'Author', type: 'text' },
            { id: 'link', name: 'Link', type: 'url' },
            { id: 'rating', name: 'Rating', type: 'number' },
          ],
        },
      },
      es: {
        title: 'Lista de lectura',
        description: 'Libros y artículos, por tipo, estado y valoración.',
        schema: {
          properties: [
            { id: 'name', name: 'Título', type: 'text' },
            {
              id: 'type',
              name: 'Tipo',
              type: 'select',
              config: {
                options: options(['Libro', 'blue'], ['Artículo', 'purple'], ['Podcast', 'orange']),
              },
            },
            {
              id: 'status',
              name: 'Estado',
              type: 'status',
              config: {
                options: options(['Por leer', 'gray'], ['Leyendo', 'blue'], ['Terminado', 'green']),
              },
            },
            { id: 'author', name: 'Autor', type: 'text' },
            { id: 'link', name: 'Enlace', type: 'url' },
            { id: 'rating', name: 'Valoración', type: 'number' },
          ],
        },
      },
    },
  },
];

/** The language a template is written in for `locale` (`es-MX` → `es`; English otherwise). */
export function templateLocale(locale: string): TemplateLocale {
  return locale.toLowerCase().startsWith('es') ? 'es' : 'en';
}
