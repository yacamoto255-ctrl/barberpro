# Robô de consulta SSW — Opção 101 (Situação do CTRC)

Abre a opção **101** do SSW, preenche o campo **NR1, NR2 ou NR**, lê o CTRC e clica em
**Cubagem/Cub Orig (m³)** para trazer as medidas. Mostra:

| Dado | De onde vem |
|---|---|
| Frete (R$) | `Valor frete (R$)` da tela 101 |
| Cubagem (m³) / Cub Orig | `Cubagem/Cub Orig (m³)` da tela 101 |
| Peso real / Peso cálculo (Kg) | tela 101 |
| Medidas (altura × largura × comprimento × vezes = total) | popup aberto ao clicar em Cubagem |
| Peso cubado (Kg) | calculado pelo robô: cubagem m³ × 300 kg/m³ (fator da operação; altere com `--fator=`) |

O robô confere cada linha de medida (A×L×C×vezes) contra o TOTAL exibido pelo SSW e avisa se divergir.

## Instalação (no seu computador, Windows)

Requer Node.js 18+.

```bash
cd ssw-robo
npm install
npx playwright install chromium
```

## Uso

```bash
# um ou vários NRs
node src/cli.js 00246554672514
node src/cli.js 00246554672514 00246554672515 --csv=saida/fretes.csv

# modo interativo (digita um NR por vez)
node src/cli.js
```

Na primeira vez abre um Chrome. Se o SSW não estiver logado, o robô pede para você fazer
o login na janela e apertar ENTER no terminal. **Sua senha não é salva pelo robô.** O perfil
do navegador fica em `ssw-robo/.perfil` (já está no `.gitignore`).

Opções: `--json`, `--csv=arquivo`, `--fator=300`, `--debug`, `--headless`, `--ajuda`.

## Se algo não for lido (calibração)

Quando der erro, ou com `--debug`, o robô salva em `ssw-robo/debug/<data>_<NR>/` o print, o
HTML e o texto de cada aba e frame. Mande essa pasta para ajustar os seletores.

## Limitações conhecidas

- **Não foi testado no SSW real.** O ambiente de desenvolvimento não tem acesso a
  `sistema.ssw.inf.br`. O fluxo foi testado num servidor que imita as telas dos prints. O
  primeiro uso real pode exigir ajuste de seletor (use `--debug`).
- Entra direto pela URL `/bin/ssw0053` (a mesma do print da opção 101). Se o seu SSW exigir
  entrar pelo menu, isso precisa ser ajustado.
- Usa o período de pesquisa que já vem preenchido na tela. NR fora desse período não é encontrado.
- Se o NR retornar mais de um CTRC (lista), o robô informa erro e salva o debug.

## Testes

```bash
npm test
```

13 testes: parser (layouts diferentes, valores vazios ou inválidos, milhar), fluxo completo no
navegador (preenche NR → resultado → popup de cubagem), fallback clicando no ▶, NR
inexistente, entrada inválida e sessão sem login.
