# GLOBAL TERRITORY — Ficha de Atributos dos Personagens

*Documento de referência para balanceamento (v1). Valores iniciais, pensados para serem ajustados via configuração no backend (World Tick / Simulation Engine, seção 31 do projeto) sem precisar alterar o cliente.*

Escala de referência: **Vida** e **Dano** em pontos abstratos (sem violência gráfica, conforme seção 21/28 — resultados de combate são calculados, não representados com sangue ou gore). **Ataque** indica o tipo (Sem ataque / Corpo a corpo / À distância / Mágico / Suporte / Sabotagem).

---

## CIVIL

| Unidade | Vida | Dano | Atributos | Costumes | Ataque | Armas / Ferramentas |
|---|---|---|---|---|---|---|
| **Worker** | 40 | 0 | Energia 100 · Carga +10 · Velocidade média | Transporta recursos entre depósitos e obras; substitui profissões ausentes em tarefas simples | Sem ataque (foge de conflitos) | Nenhuma |
| **Farmer** | 40 | 0 | Energia 90 · Produtividade agrícola +20% | Planta, rega e colhe; dorme perto da fazenda que cuida | Sem ataque | Foice |
| **Builder** | 45 | 0 | Energia 90 · Velocidade de construção +20% | Executa ordens de construção; busca madeira/pedra no armazém | Sem ataque | Martelo |
| **Miner** | 45 | 2 | Energia 85 · Extração de minério +20% | Escava em montanhas/minas; retorna com carga ao depósito | Corpo a corpo (defesa pessoal fraca) | Picareta |
| **Trader** | 35 | 0 | Energia 80 · Barganha +15% | Viaja entre mercados negociando preços; evita rotas hostis | Sem ataque (foge) | Nenhuma |

---

## MILITARY

| Unidade | Vida | Dano | Atributos | Costumes | Ataque | Armas |
|---|---|---|---|---|---|---|
| **Militia** | 50 | 8 | Defesa baixa · Custo de recrutamento baixo | Convocado às pressas; primeira linha de defesa territorial | Corpo a corpo | Adaga/cajado improvisado |
| **Swordsman** | 70 | 14 | Defesa média · Velocidade média | Patrulha fronteiras; forma pelotões organizados | Corpo a corpo | Espada |
| **Spearman** | 65 | 12 (+bônus vs. cavalaria) | Alcance curto · Bom em formação | Linha de frente contra unidades montadas | Corpo a corpo (alcance) | Lança |
| **Archer** | 45 | 16 | Alcance longo · Defesa baixa | Ataca à distância e recua se for aproximado | À distância | Arco e flecha |
| **Crossbowman** | 50 | 20 | Alcance médio · Cadência de tiro lenta | Alto dano por disparo, mas recarga demorada | À distância | Besta |
| **Cavalry** | 90 | 18 | Velocidade alta · Mobilidade | Flanqueia, persegue fugitivos, ataques relâmpago | Corpo a corpo (montado) | Espada/lança curta |
| **Knight** | 130 | 22 | Defesa alta · Armadura pesada · Velocidade baixa | Absorve o impacto principal da batalha pelo grupo | Corpo a corpo | Espada e escudo pesados |
| **Ranger** | 60 | 15 | Furtividade · Visão ampliada | Emboscadas e reconhecimento avançado em território hostil | Híbrido (corpo a corpo e à distância) | Arco curto + faca |

---

## SPECIALIST

| Unidade | Vida | Dano | Atributos | Costumes | Ataque | Equipamento |
|---|---|---|---|---|---|---|
| **Scout** | 35 | 2 | Velocidade muito alta · Visão +50% | Explora território desconhecido e reporta movimentações inimigas | Evita combate | Nenhuma |
| **Engineer** | 45 | 0 | Reparo +25% · Monta máquinas de cerco | Repara fortificações e monta/desmonta equipamentos de cerco em campo | Sem ataque | Ferramentas |
| **Healer** | 40 | 0 | Cura em área · Regeneração de energia dos aliados | Acompanha tropas e restaura vida durante conflitos | Suporte (sem dano) | Cajado de cura |
| **Spy** | 30 | 5 (via sabotagem) | Furtividade alta · Infiltração | Espiona territórios rivais e sabota estoques/produção | Ataque indireto (sabotagem) | Adaga oculta |
| **Commander** | 80 | 10 | Liderança (+dano/moral às tropas próximas) | Coordena exércitos e aumenta a eficácia do grupo em batalha | Corpo a corpo + aura de comando | Espada de comando |

---

## MAGIC

*Categoria adicional ao escopo original do projeto — mantém a estética abstrata em pixel art, sem efeitos realistas ou violentos; magia representada como partículas/ícones estilizados.*

| Unidade | Vida | Dano | Atributos | Costumes | Ataque | Foco/Armas |
|---|---|---|---|---|---|---|
| **Apprentice** | 35 | 10 | Mana baixa · Em treinamento | Estuda feitiços básicos; apoio leve em combate | Mágico à distância (fraco) | Cajado simples |
| **Mage** | 45 | 20 | Mana média · Alcance mágico | Ataca grupos inimigos à distância com feitiços | Mágico à distância | Cajado/grimório |
| **Battle Mage** | 65 | 24 | Mana média · Híbrido de combate | Combina magia e combate corpo a corpo na linha de frente | Mágico + corpo a corpo | Espada encantada |
| **Arcane Commander** | 75 | 15 | Mana alta · Aura de buff/debuff | Fortalece aliados e enfraquece inimigos em área | Suporte mágico + dano em área | Cetro arcano |

---

## SIEGE

*Máquinas de guerra — dano voltado principalmente contra fortificações/construções, sem representação gráfica de baixas.*

| Unidade | Vida | Dano | Atributos | Costumes | Ataque | Equipamento |
|---|---|---|---|---|---|---|
| **Ram** | 200 | 30 (vs. estruturas) | Muito lento · Resistente a flechas | Avança lentamente até muralhas, escoltado por tropas | Impacto contra fortificações | Aríete |
| **Catapult** | 90 | 35 (dano em área) | Alcance longo · Frágil em combate próximo | Bombardeia construções à distância | À distância (área) | Contrapeso/projéteis |
| **Ballista** | 100 | 40 (perfurante) | Alcance muito longo · Alta precisão | Ataca unidades e fortificações em linha reta | À distância (linha reta) | Lança gigante |
| **Siege Engine** | 250 | 25 | Vida muito alta · Multifuncional | Torre móvel usada para escalar muralhas e apoiar o cerco | Suporte de cerco + impacto | Torre de assédio |

---

## Notas de balanceamento

- **Progressão de poder:** Civil (0 de dano, foco em produção) → Specialist (suporte/utilidade) → Military (combate direto) → Magic (dano/suporte mágico) → Siege (alto HP/dano, baixíssima mobilidade, foco em estruturas).
- **Integração com a simulação:** estes valores alimentam o cálculo de batalha da seção 21 do projeto (força do exército × defesa × fortificação × tecnologia × moral/liderança × terreno × alianças) e devem ficar em `ArmyUnit`/`Character` no banco (seção 37), configuráveis pelo backend a cada *World Tick*.
- **Custo de recursos** (madeira, comida, pedra, ouro por unidade) e **tempo de recrutamento** não foram incluídos aqui — recomendo uma segunda tabela dedicada a isso quando a economia (seção 17-18) estiver mais definida.
- Todos os nomes, aparência e sprites devem ser criados como identidade visual própria do projeto (pixel art autoral), sem reaproveitar assets de terceiros.
