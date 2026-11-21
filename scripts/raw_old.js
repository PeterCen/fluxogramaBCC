/**
 * Matriz curricular de referência extraída do PPC 2018 de Ciência da Computação.
 * Documento de origem: PPC-CienciadaComputacao-Epitacio-antiga.pdf
 * Câmpus: IFSP Presidente Epitácio
 *
 * Estrutura da tupla de cada disciplina:
 * [0] sigla: string         - Código identificador da disciplina (ex: "AP1C1")
 * [1] nome: string          - Nome completo da disciplina
 * [2] semestre: number      - Semestre de oferta sugerido (1 a 8 = obrigatórias, 9 = eletivas, 10 = optativas, 11/12 = TCC)
 * [3] aulas: number         - Quantidade de aulas semanais (convertido para horas relógio via aulas * 19 * 50 / 60)
 * [4] extensao: number (0/1)- 0 na grade de 2018 (anterior às diretrizes de curricularização de extensão)
 * [5] prereqs: string[]     - Lista com siglas das disciplinas pré-requisito obrigatórias
 *
 * OBSERVAÇÃO ARQUITETURAL:
 * Este arquivo foi preservado na pasta scripts/ como referência histórica de extração dos PDFs.
 * O aplicativo web consome os dados em JSON puro através de:
 * assets/data/courses/bcc-2018.json
 */

export const RAW_ANTIGA = [
    // módulo 1
    ["ADMC1", "Administração", 1, 2, 0, []],
    ["AP1C1", "Algoritmos e Programação I", 1, 4, 0, []],
    ["EL1C1", "Eletrônica Digital I", 1, 4, 0, []],
    ["FMTC1", "Fundamentos de Matemática", 1, 4, 0, []],
    ["INGC1", "Inglês Instrumental", 1, 4, 0, []],
    ["ICCC1", "Introdução à Ciência da Computação", 1, 2, 0, []],
    ["LACC1", "Laboratório de Computação", 1, 2, 0, []],
    ["LOGC1", "Lógica", 1, 2, 0, []],
    // módulo 2
    ["AP2C2", "Algoritmos e Programação II", 2, 6, 0, ["AP1C1"]],
    ["AOCC2", "Arquitetura e Organização de Computadores", 2, 4, 0, []],
    ["CL1C2", "Cálculo I", 2, 4, 0, ["FMTC1"]],
    ["COEC2", "Comunicação e Expressão", 2, 2, 0, []],
    ["EL2C2", "Eletrônica Digital II", 2, 4, 0, []],
    ["FDSC2", "Fundamentos de Sistemas", 2, 2, 0, []],
    ["MADC2", "Matemática Discreta", 2, 2, 0, []],
    ["MTPC2", "Metodologia de Pesquisa", 2, 2, 0, []],
    // módulo 3
    ["BD1C3", "Banco de Dados I", 3, 4, 0, []],
    ["CL2C3", "Cálculo II", 3, 4, 0, ["CL1C2"]],
    ["ENGC3", "Engenharia de Software", 3, 4, 0, []],
    ["ED1C3", "Estruturas de Dados I", 3, 4, 0, ["AP2C2"]],
    ["GPNC3", "Gestão de Processos de Negócio", 3, 2, 0, []],
    ["LMOC3", "Linguagem de Montagem", 3, 2, 0, ["AOCC2"]],
    ["POOC3", "Programação Orientada a Objetos", 3, 4, 0, ["AP1C1"]],
    ["SOPC3", "Sistemas Operacionais", 3, 4, 0, ["AP2C2"]],
    // módulo 4
    ["APSC4", "Análise e Projeto de Sistemas", 4, 4, 0, ["POOC3"]],
    ["BD2C4", "Banco de Dados II", 4, 4, 0, ["BD1C3"]],
    ["ED2C4", "Estruturas de Dados II", 4, 4, 0, ["ED1C3"]],
    ["FP1C4", "Ferramentas de Programação I", 4, 4, 0, ["POOC3", "BD1C3"]],
    ["FNCC4", "Finanças e Custos", 4, 2, 0, []],
    ["GEAC4", "Geometria Analítica", 4, 4, 0, []],
    ["LPRC4", "Linguagens de Programação", 4, 4, 0, ["POOC3"]],
    ["RC1C4", "Redes de Computadores I", 4, 4, 0, ["EL1C1"]],
    // módulo 5
    ["ALIC5", "Álgebra Linear", 5, 4, 0, []],
    ["CANC5", "Cálculo Numérico", 5, 2, 0, []],
    ["EMPC5", "Empreendedorismo", 5, 4, 0, []],
    ["FP2C5", "Ferramentas de Programação II", 5, 4, 0, ["POOC3", "BD1C3"]],
    ["GPRC5", "Gestão de Projetos", 5, 4, 0, []],
    ["RC2C5", "Redes de Computadores II", 5, 4, 0, ["EL1C1"]],
    ["TCOC5", "Teoria da Computação", 5, 4, 0, []],
    ["TBDC5", "Tópicos em Banco de Dados", 5, 2, 0, ["BD1C3"]],
    // módulo 6
    ["CPLC6", "Compiladores", 6, 4, 0, ["ED2C4", "LPRC4", "TCOC5"]],
    ["CEMC6", "Computação Embarcada", 6, 2, 0, ["AP2C2", "EL2C2"]],
    ["CGRC6", "Computação Gráfica", 6, 4, 0, ["ED2C4"]],
    ["FP3C6", "Ferramentas de Programação III", 6, 4, 0, ["POOC3", "BD1C3"]],
    ["GTIC6", "Gestão da Tecnologia da Informação", 6, 4, 0, []],
    ["IHCC6", "Interação Humano-Computador", 6, 2, 0, []],
    ["PREC6", "Probabilidade e Estatística", 6, 4, 0, ["CL2C3"]],
    ["SIDC6", "Sistemas Distribuídos", 6, 4, 0, ["RC2C5"]],
    // módulo 7
    ["IARC7", "Inteligência Artificial", 7, 4, 0, ["ED2C4"]],
    ["PI1C7", "Projeto Integrado I", 7, 2, 0, ["APSC4", "FP1C4"]],
    ["QSFC7", "Qualidade de Software", 7, 4, 0, []],
    ["SEGC7", "Segurança e Auditoria de Sistemas", 7, 4, 0, []],
    ["TGRC7", "Teoria dos Grafos", 7, 4, 0, ["ED2C4"]],
    // módulo 8
    ["CESC8", "Computação e Sociedade", 8, 2, 0, []],
    ["PI2C8", "Projeto Integrado II", 8, 2, 0, ["PI1C7"]],
    // eletivas (9) e optativa (10)
    ["TEPC0", "Tópicos Especiais", 9, 4, 0, ["POOC3"]],
    ["TPRC0", "Tópicos em Programação", 9, 4, 0, ["BD1C3", "POOC3"]],
    ["TPWC0", "Tópicos em Programação Web", 9, 4, 0, ["BD1C3", "POOC3"]],
    ["TSOC0", "Tópicos em Sist. Operacionais", 9, 4, 0, ["SOPC3"]],
    ["IDSC0", "Implantação de Servidores", 9, 4, 0, ["SOPC3"]],
    ["TESC0", "Tópicos em Eng. de Software", 9, 4, 0, ["ENGC3"]],
    ["VCOC0", "Visão Computacional", 9, 4, 0, ["ED2C4"]],
    ["RENC0", "Redes Neurais Artificiais", 9, 4, 0, ["ED2C4"]],
    ["CIDC0", "Ciência de Dados", 9, 4, 0, ["BD2C4"]],
    ["LBSC0", "Libras (optativa)", 10, 2, 0, []],
    // TCC
    ["TCC1", "TCC 1", 11, 2, 0, []],
    ["TCC2", "TCC 2", 12, 2, 0, ["TCC1"]]
];
