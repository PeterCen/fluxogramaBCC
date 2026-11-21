# Scripts de Extração e Conversão de Dados Curriculares

Este diretório contém os scripts e matrizes de referência utilizados na extração e validação dos dados curriculares a partir dos Projetos Pedagógicos de Curso (PPCs) em formato PDF.

---

## 🎯 Separação de Dados e Lógica (Arquitetura Orientada a Dados)

Para evitar a mistura de dados com a lógica de execução e permitir a escalabilidade para múltiplos cursos:

1. **Produção (JSON Puro)**:
   - Os dados consumidos em tempo de execução pela aplicação web residem exclusivamente em arquivos **JSON puros** no diretório [`assets/data/courses/`](../assets/data/courses/):
     - `bcc-2022.json`: Bacharelado em Ciência da Computação (PPC 2022).
     - `bcc-2018.json`: Bacharelado em Ciência da Computação (PPC 2018).
     - `pedagogia-2023.json`: Licenciatura em Pedagogia (PPC 2023).
     - `index.json`: Manifesto de registro dos cursos disponíveis.
   - O código em `assets/js/` não contém matrizes de disciplinas embutidas; ele apenas consome os dados assincronamente através de `assets/js/courses.js`.

2. **Ferramental e Extração (`scripts/`)**:
   - Os scripts de processamento, auditoria e referência histórica de extração dos PDFs ficam isolados nesta pasta (`scripts/`).

---

## 📁 Arquivos deste Diretório

| Arquivo | Descrição | Origem / PDF |
|---|---|---|
| [`raw_new.js`](raw_new.js) | Matriz de tuplas das 65 disciplinas da grade nova de Ciência da Computação. | `2022.12.06-PPC-BAC-Ciência-Computação-PEP-Reformulação.pdf` |
| [`raw_old.js`](raw_old.js) | Matriz de tuplas das 67 disciplinas da grade antiga de Ciência da Computação. | `PPC-CienciadaComputacao-Epitacio-antiga.pdf` |
| [`convert_raw_to_json.mjs`](convert_raw_to_json.mjs) | Script de auditoria e validação que verifica a paridade exata (100%) entre as matrizes raw e os arquivos JSON puros. | Pipeline de validação Node.js |
| [`extract_equivalence.mjs`](extract_equivalence.mjs) | Script de auditoria e extração que valida a matriz oficial de equivalência entre PPC 2018 e PPC 2022/2023. | `equivalencia matérias.pdf` (SUAP 1787471) |
| [`cache_bust.mjs`](cache_bust.mjs) | Script de automação de cache busting: gera hash SHA-256 de `styles.css` e atualiza `index.html` e `pedagogia/index.html`. | Automação de CI e Pre-commit |

---

## 🔍 Estrutura das Tuplas nas Matrizes `raw_*.js`

Cada disciplina é representada por uma tupla de 6 posições:
```javascript
[sigla, nome, semestre, carga, extensao, prerequisitos]
```
- **`sigla`** (*string*): Código identificador da disciplina (ex: `"ALP1"`, `"HED1"`).
- **`nome`** (*string*): Nome completo oficial da disciplina no PPC.
- **`semestre`** (*number*): Semestre ideal de oferta (1 a 8 para obrigatórias, 9 para eletivas, 10 para optativas, 11/12 para etapas de TCC).
- **`carga`** (*number*): Quantidade de aulas semanais (convertidas em horas via `aulas * 19 * 50 / 60`) ou horas totais.
- **`extensao`** (*number: 0 ou 1*): Flag booleana indicando se a disciplina possui carga curricular de extensão (destacada com faixa rosa no fluxograma).
- **`prerequisitos`** (*string[]*): Lista de siglas de disciplinas que devem estar concluídas para liberação.

---

## 🚀 Como Executar o Script de Auditoria e Conversão

Para verificar a integridade e paridade entre as matrizes de extração e os JSONs em produção:

```bash
node scripts/convert_raw_to_json.mjs
```

O script verifica:
- Quantidade de disciplinas cadastradas;
- Paridade de siglas, nomes, semestres e cargas horárias;
- Igualdade estrita nos grafos de pré-requisitos;
- Validação no schema de catálogo (`validateCourseConfig()`).
