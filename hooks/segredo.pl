#!/usr/bin/env perl
#
# O valor de um segredo não chega à saída de ferramenta nenhuma do Claude Code.
#
# Decidido pelo João em 02/10/2026, na zippi-brtech/zippi-datawarehouse#226, depois de dois vazamentos
# no mesmo dia: o BETTER_AUTH_SECRET num `sed` que listava o `.env`, e o GITHUB_TOKEN num
# `env | grep GIT` de subagente. Nada é recusado. O valor vira `<oculto:NOME>` antes de chegar ao
# transcript, e o agente continua lendo, editando e usando `.env`.
#
#   segredo.pl pre      PreToolUse. O Bash passa pelo filtro, e o Edit e o Write de arquivo de
#                       segredo recebem de volta o valor que a saída escondeu
#   segredo.pl post     PostToolUse. A rede, que troca o valor na saída de qualquer ferramenta, MCP inclusive
#   segredo.pl filtro   o filtro de stdin para stdout que o Bash reescrito usa
#   segredo.pl --teste  prova os casos da #226, só com segredo falso
#
# Os valores vêm do ~/.secrets, dos .env* dos repos em ~/getdemo/ e das variáveis de ambiente com
# nome de segredo, mais a senha de toda URL usuario:senha@. A lista mora em ~/.cache/claude-segredo/,
# com modo 600, e é refeita quando uma fonte muda.

use strict;

# Cada módulo carregado custa de 2 a 24 ms nesta máquina, e o hook roda em toda chamada de
# ferramenta. Por isso nada é carregado no topo, e cada modo carrega só o que usa. O `warnings` fica
# de fora também porque o aviso do filtro sairia no meio da saída do comando. O `--teste` compila o
# arquivo com ele.

my $HOME    = $ENV{HOME} // '';
my $CACHE   = $ENV{SEGREDO_CACHE}   // "$HOME/.cache/claude-segredo";
my $SECRETS = $ENV{SEGREDO_SECRETS} // "$HOME/.secrets";
my $RAIZ    = $ENV{SEGREDO_RAIZ}    // "$HOME/getdemo";
my $SELF    = $0;

# `PW` entrou pelo NEKT_PW, que nenhum dos outros casava.
my $NOME_DE_SEGREDO = qr/TOKEN|SECRET|PASSWORD|PASS|PW|KEY|AUTH|CREDENTIAL/i;

# Abaixo disso o valor é palavra comum ou senha de banco local, e trocar `postgres` em toda saída
# quebraria mais do que protege.
my $MINIMO = 12;

# A lista é refeita no máximo a cada 10 minutos mesmo sem fonte mudar, para pegar o `.env` que
# nasceu numa pasta mais funda do que as que a conferência de mtime olha.
my $VALIDADE = 600;

# O token que não está em lista nenhuma, pelo formato que o emissor publica.
my @FORMATOS = (
  [github    => qr/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/],
  [anthropic => qr/\bsk-ant-[A-Za-z0-9_-]{20,}/],
  [aws       => qr/\bAKIA[0-9A-Z]{16}\b/],
  [slack     => qr/\bxox[bp]-[A-Za-z0-9-]{10,}/],
);

my %PULA = map { $_ => 1 } qw(node_modules .git .next .turbo .yarn dist build coverage);

# O JSON entra e sai como bytes. Com utf8 ligado, o valor do `.env`, que é byte, deixaria de casar
# com o texto decodificado.
my $JSON_PP;
sub json {
  require JSON::PP;
  return $JSON_PP //= JSON::PP->new->latin1->allow_nonref->canonical;
}

sub atribuicoes {
  my ($arquivo) = @_;
  open my $fh, '<', $arquivo or return ();
  my @pares;
  while (my $linha = <$fh>) {
    next unless $linha =~ /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;
    my ($nome, $valor) = ($1, $2);
    if    ($valor =~ /^"(.*)"$/) { $valor = $1 }
    elsif ($valor =~ /^'(.*)'$/) { $valor = $1 }
    else                         { $valor =~ s/\s+#.*$// }
    push @pares, [$nome, $valor];
  }
  return @pares;
}

sub decodifica_url {
  my ($s) = @_;
  $s =~ s/%([0-9A-Fa-f]{2})/chr(hex $1)/ge;
  return $s;
}

sub candidatos {
  my ($nome, $valor, $todo_nome_vale) = @_;
  my @pares;
  for my $senha ($valor =~ m{://[^/\s:@]+:([^@\s/]+)@}g) {
    push @pares, [$nome, $senha];
    my $clara = decodifica_url($senha);
    push @pares, [$nome, $clara] if $clara ne $senha;
  }
  # Na URL, o segredo é a senha. A URL inteira é o endereço do serviço, que aparece em log e em erro.
  return @pares if $valor =~ m{^[A-Za-z][A-Za-z0-9+.-]*://};
  push @pares, [$nome, $valor] if $todo_nome_vale || $nome =~ $NOME_DE_SEGREDO;
  return @pares;
}

sub aceita {
  my ($v) = @_;
  return length($v) >= $MINIMO
    && $v !~ m{^/}
    && $v !~ /[\t\n]/
    && $v !~ /^\$\{?\w+\}?$/
    && $v !~ /^<oculto:/;
}

sub varre {
  my ($pasta, $fundo, $arquivos, $pastas) = @_;
  opendir my $dh, $pasta or return;
  push @$pastas, $pasta if $fundo >= 2;
  for my $n (readdir $dh) {
    next if $n eq '.' || $n eq '..';
    my $c = "$pasta/$n";
    if (-d $c && !-l $c) {
      varre($c, $fundo - 1, $arquivos, $pastas) if $fundo > 0 && !$PULA{$n};
    } elsif ($n =~ /^\.env/ && -f $c) {
      push @$arquivos, $c;
    }
  }
}

sub grava {
  my ($destino, @linhas) = @_;
  my $tmp = "$destino.$$";
  my $velho = umask 077;
  open my $fh, '>', $tmp or do { umask $velho; return };
  umask $velho;
  print $fh @linhas;
  close $fh;
  rename $tmp, $destino;
}

sub refaz_cache {
  mkdir $CACHE, 0700 unless -d $CACHE;
  chmod 0700, $CACHE;
  my (@envs, @pastas);
  varre($RAIZ, 5, \@envs, \@pastas) if -d $RAIZ;

  # Valor que está num `.example` já é público no git, como a senha do Postgres local.
  my %publicado;
  for my $f (grep { /\.example$/ } @envs) {
    $publicado{ $_->[1] } = 1 for map { candidatos(@$_, 1) } atribuicoes($f);
  }

  my @pares;
  push @pares, map { candidatos(@$_, 1) } atribuicoes($SECRETS) if -f $SECRETS;
  for my $f (grep { !/\.example$/ } @envs) {
    push @pares, map { candidatos(@$_, 0) } atribuicoes($f);
  }

  my %visto;
  my @linhas = map { "$_->[0]\t$_->[1]\n" }
    grep { !$visto{ $_->[1] }++ && !$publicado{ $_->[1] } && aceita($_->[1]) } @pares;
  grava("$CACHE/fontes", map { "$_\n" } grep { -e } ($SECRETS, @envs, @pastas));
  grava("$CACHE/valores", @linhas, map { "-\t$_\n" } sort keys %publicado);
}

# O mtime é de segundo inteiro. Por isso a fonte do mesmo segundo da lista também refaz: a mudança
# que caiu no segundo em que a lista nasceu não fica de fora.
sub cache_em_dia {
  my @st = stat "$CACHE/valores";
  return 0 unless @st && time - $st[9] < $VALIDADE;
  open my $fh, '<', "$CACHE/fontes" or return 0;
  while (my $f = <$fh>) {
    chomp $f;
    my @s = stat $f;
    return 0 if !@s || $s[9] >= $st[9];
  }
  return 1;
}

sub tabela {
  refaz_cache() unless cache_em_dia();
  my (%nome_de, %publicado);
  if (open my $fh, '<', "$CACHE/valores") {
    while (my $l = <$fh>) {
      chomp $l;
      my ($nome, $valor) = split /\t/, $l, 2;
      next unless defined $valor;
      if ($nome eq '-') { $publicado{$valor} = 1 }
      else              { $nome_de{$valor} //= $nome }
    }
  }
  for my $nome (sort grep { !/^SEGREDO_/ && defined $ENV{$_} } keys %ENV) {
    for (candidatos($nome, $ENV{$nome}, 0)) {
      my $v = $_->[1];
      $nome_de{$v} //= $nome if aceita($v) && !$publicado{$v};
    }
  }
  my @valores = sort { length($b) <=> length($a) || $a cmp $b } keys %nome_de;
  my $re = @valores ? join('|', map { quotemeta } @valores) : undef;
  return { nome_de => \%nome_de, re => (defined $re ? qr/($re)/ : undef) };
}

sub troca {
  my ($texto, $t, $achados) = @_;
  if ($t->{re}) {
    $texto =~ s/$t->{re}/$achados->{ $t->{nome_de}{$1} }++; "<oculto:$t->{nome_de}{$1}>"/ge;
  }
  for (@FORMATOS) {
    my ($nome, $re) = @$_;
    $texto =~ s/$re/$achados->{$nome}++; "<oculto:$nome>"/ge;
  }
  return $texto;
}

sub limpa {
  my ($dado, $t, $achados) = @_;
  return [map { limpa($_, $t, $achados) } @$dado] if ref $dado eq 'ARRAY';
  return { map { $_ => limpa($dado->{$_}, $t, $achados) } keys %$dado } if ref $dado eq 'HASH';
  return troca($dado, $t, $achados) if defined $dado && !ref $dado;
  return $dado;
}

sub sh {
  my ($s) = @_;
  $s =~ s/'/'\\''/g;
  return "'$s'";
}

sub responde {
  my ($saida) = @_;
  print json()->encode({ hookSpecificOutput => $saida });
}

sub le_bruto {
  local $/;
  return <STDIN> // '';
}

sub decodifica {
  my ($bruto) = @_;
  return eval { json()->decode($bruto) } // {};
}

sub e_arquivo_de_segredo {
  my ($caminho) = @_;
  return 1 if $caminho =~ m{(?:^|/)\.env[^/]*$};
  require Cwd;
  my $real = Cwd::abs_path($caminho) // $caminho;
  return $real eq (Cwd::abs_path($SECRETS) // $SECRETS);
}

sub corpo_json {
  my ($s) = @_;
  $s =~ s/(["\\])/\\$1/g;
  $s =~ s/\n/\\n/g;
  return $s;
}

# O Bash é a chamada mais comum, e o JSON::PP custa 17 ms para carregar. Por isso este caminho não
# decodifica nada: o comando novo é o prefixo já escapado seguido do comando como ele veio no JSON.
sub pre_bash {
  my ($bruto) = @_;
  # Fora do bypass, o comando reescrito passaria pela regra de permissão no lugar do original, e
  # toda regra `Bash(git status:*)` deixaria de casar. Ali a rede do PostToolUse cobre a saída.
  return unless $bruto =~ /"permission_mode"\s*:\s*"bypassPermissions"/;
  # O `zshexit` que espera o filtro só existe no zsh.
  return unless ($ENV{SHELL} // '') =~ m{/zsh$};
  my $string = qr/"(?:[^"\\]++|\\.)*+"/s;
  return unless $bruto =~ /"tool_input"\s*:\s*(\{(?:[^{}"]++|$string)*+\})/;
  my $entrada = $1;
  return unless $entrada =~ /(?:(?<=\{)|(?<=,))\s*"command"\s*:\s*"((?:[^"\\]++|\\.)*+)"/s;
  return if $1 =~ /\A(?:\s|\\[nrt])*\z/;

  # O `exec` troca a saída do próprio shell da chamada, e o `cd` e o código de saída continuam os do
  # comando. Pipe rodaria o comando num subshell, e o `cd` se perderia. O zsh não espera o `>(...)`
  # ao sair, e o Claude Code lê a saída quando o shell sai: sem o `zshexit`, o fim chegaria cortado.
  my $perl = sh($^X) . ' ' . sh($SELF);
  my $prefixo = corpo_json(join "\n",
    '__segredo_vivo="${TMPDIR:-/tmp}/segredo-vivo.$$"',
    ': >| "$__segredo_vivo"',
    "zshexit() { exec >&- 2>&-; $perl espera \"\$__segredo_vivo\" }",
    "exec > >($perl filtro \"\$__segredo_vivo\") 2>&1",
    '');
  $entrada =~ s/(?:(?<=\{)|(?<=,))(\s*"command"\s*:\s*")/$1$prefixo/;
  print '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":' . $entrada . '}}';
}

sub pre {
  my $bruto = le_bruto();
  return pre_bash($bruto) if $bruto =~ /"tool_name"\s*:\s*"Bash"/;
  my $in = decodifica($bruto);
  my $ferramenta = $in->{tool_name} // '';
  my $entrada    = $in->{tool_input} // {};

  if ($ferramenta eq 'Edit' || $ferramenta eq 'Write') {
    my $caminho = $entrada->{file_path} // return;
    return unless e_arquivo_de_segredo($caminho);
    my $t = tabela();
    # O nome repetido em dois `.env` com valores diferentes resolve pelo arquivo que está sendo editado.
    my %valor_de = map { $t->{nome_de}{$_} => $_ } keys %{ $t->{nome_de} };
    for (map { candidatos(@$_, 0) } atribuicoes($caminho)) {
      $valor_de{ $_->[0] } = $_->[1] if aceita($_->[1]);
    }
    my %mudou;
    for my $campo (qw(old_string new_string content)) {
      my $texto = $entrada->{$campo};
      next unless defined $texto && $texto =~ /<oculto:/;
      my $antes = $texto;
      $texto =~ s/<oculto:([A-Za-z0-9_]+)>/exists $valor_de{$1} ? $valor_de{$1} : "<oculto:$1>"/ge;
      $mudou{$campo} = $texto if $texto ne $antes;
    }
    return unless %mudou;
    # O 2.1.287 troca a entrada inteira pelo `updatedInput`, e o campo que faltar reprova no schema.
    responde({
      hookEventName     => 'PreToolUse',
      updatedInput      => { %$entrada, %mudou },
      additionalContext => 'O hook de segredo gravou o valor real no lugar de cada <oculto:NOME>. '
        . 'O arquivo tem o valor, e a saída continua mostrando o marcador.',
    });
  }
}

sub post {
  my $bruto = le_bruto();
  my $t = tabela();
  # O caminho rápido, sem decodificar o JSON. Valor com aspa ou barra invertida aparece escapado no
  # JSON, e só ele obriga a decodificar sempre.
  my $escapado = grep { /["\\]/ } keys %{ $t->{nome_de} };
  my $toca = $escapado || ($t->{re} && $bruto =~ $t->{re}) || grep { $bruto =~ $_->[1] } @FORMATOS;
  return unless $toca;
  my $in = decodifica($bruto);
  return unless exists $in->{tool_response};

  my %achados;
  my $limpo = limpa($in->{tool_response}, $t, \%achados);
  return unless %achados;

  my $nomes = join ', ', sort keys %achados;
  my %saida = (
    hookEventName     => 'PostToolUse',
    additionalContext => "A saída desta ferramenta tinha o valor de $nomes, e o hook de segredo "
      . "trocou por <oculto:...> antes de chegar a você. Se você ainda vê o valor, diga ao João "
      . "que $nomes vazou no transcript e precisa ser rotacionado.",
  );
  # No 2.1.287 o `updatedToolOutput` vale para MCP também, com a forma do `tool_response`, que ali é
  # a lista de blocos. O `updatedMCPToolOutput` chegava ao modelo como o texto do objeto inteiro.
  $saida{updatedToolOutput} = $limpo;
  responde(\%saida);
}

# O arquivo `vivo` diz ao `espera` que o filtro está de pé: vazio antes de ele nascer, com o pid
# enquanto ele roda, e apagado quando a saída inteira já foi escrita.
sub filtro {
  my ($vivo) = @_;
  if (defined $vivo && open my $fh, '>', $vivo) { print $fh $$; close $fh }
  my $t = tabela();
  binmode STDIN;
  binmode STDOUT;
  $| = 1;
  my %ignora;
  print troca($_, $t, \%ignora) while <STDIN>;
  unlink $vivo if defined $vivo;
}

# O teto de 2,5 s é para o comando que deixa um filho em segundo plano segurando a saída. O filtro
# continua passando o que ele escreve depois, e a chamada não fica presa esperando o filho.
sub espera {
  my ($vivo) = @_;
  return unless defined $vivo;
  my $pid = '';
  for (1 .. 2500) {
    return unless -e $vivo;
    if ($pid eq '' && open my $fh, '<', $vivo) { $pid = <$fh> // ''; close $fh }
    last if $pid ne '' && !kill 0, $pid;
    select undef, undef, undef, 0.001;
  }
  unlink $vivo;
}

# --- o teste -----------------------------------------------------------------------------------

my ($T, $falhas, $casos) = ('', 0, 0);

sub roda {
  my ($entrada, $pasta, @argv) = @_;
  my ($fh, $arq) = File::Temp::tempfile(DIR => $T);
  print $fh $entrada;
  close $fh;
  my $pid = fork // die "fork: $!";
  if (!$pid) {
    chdir $pasta if defined $pasta;
    open STDIN,  '<',  $arq;
    open STDOUT, '>',  "$arq.saida";
    open STDERR, '>&', \*STDOUT;
    exec @argv or exit 127;
  }
  waitpid $pid, 0;
  my $codigo = $? >> 8;
  open my $o, '<', "$arq.saida";
  local $/;
  return (scalar(<$o>) // '', $codigo);
}

# O Claude Code roda `eval '<comando>' && pwd -P >| <arquivo>` num zsh, com a saída num arquivo, e
# lê o arquivo quando o processo sai. Aqui é o mesmo, com o comando que o hook devolveu.
sub roda_como_o_claude {
  my ($comando, $pasta, $modo) = @_;
  my $json = json()->encode({
    tool_name       => 'Bash',
    tool_input      => { command => $comando, description => 'teste' },
    permission_mode => $modo // 'bypassPermissions',
  });
  my ($resposta) = roda($json, undef, $^X, $SELF, 'pre');
  my $final = $resposta eq '' ? $comando : json()->decode($resposta)->{hookSpecificOutput}{updatedInput}{command};
  my $cwd = "$T/cwd";
  unlink $cwd;
  my ($saida, $codigo) = roda('', $pasta, 'zsh', '-f', '-c', 'eval "$1" && pwd -P >| "$2"', 'zsh', $final, $cwd);
  my $onde = -f $cwd ? do { open my $c, '<', $cwd; my $l = <$c>; chomp $l; $l } : '';
  return ($saida, $codigo, $onde, $resposta);
}

sub caso {
  my ($nome, $ok) = @_;
  $casos++;
  return if $ok;
  $falhas++;
  print "FALHOU  $nome\n";
}

sub escreve {
  my ($arq, $texto) = @_;
  open my $fh, '>', $arq or die "$arq: $!";
  print $fh $texto;
  close $fh;
}

sub teste {
  require Cwd;
  require File::Path;
  require File::Temp;
  require Time::HiRes;
  $T = File::Temp::tempdir('segredo-teste.XXXXXX', TMPDIR => 1, CLEANUP => 1);
  my ($aviso) = roda('', undef, $^X, '-Mwarnings', '-c', $SELF);
  caso('o arquivo compila sem aviso', $aviso =~ /syntax OK\s*\z/ && $aviso !~ /line \d+/);
  my $falso_gh   = 'ghp_' . ('Teste0' x 6);
  my $falso_auth = 'segredo-falso-de-sessao-' . ('x' x 40);
  my $falso_pg   = 'senha-falsa-do-banco-123';
  my $falso_bi   = 'senha-falsa-do-bi-4567';
  my $falso_novo = 'token-falso-que-chegou-depois';
  my $publicada  = 'senha-publicada-no-exemplo';

  File::Path::make_path("$T/repos/bi/apps/bi", "$T/repos/bi/sub", "$T/home");
  escreve("$T/secrets", "# falso\nexport GITHUB_TOKEN=$falso_gh\nexport BI_MCP_PG_URL=postgres://mcp:$falso_pg\@db:5432/x\n");
  escreve("$T/repos/bi/apps/bi/.env", join "\n",
    "BETTER_AUTH_SECRET=$falso_auth",
    "BETTER_AUTH_URL=http://localhost:3000",
    "PORT=3000",
    "DATABASE_URL=postgres://bi:$falso_bi\@127.0.0.1:5432/bi",
    "WAREHOUSE_DATABASE_URL=postgres://w:$publicada\@localhost/w",
    '');
  escreve("$T/repos/bi/.env.example", "WAREHOUSE_DATABASE_URL=postgres://w:$publicada\@localhost/w\n");
  my $env_bi = "$T/repos/bi/apps/bi/.env";

  # O ambiente do teste é só este. O segredo de verdade do shell que roda o teste não entra em nada.
  %ENV = (
    HOME            => "$T/home",
    PATH            => $ENV{PATH} // '/usr/bin:/bin',
    SHELL           => '/usr/bin/zsh',
    LANG            => 'C.UTF-8',
    GITHUB_TOKEN    => $falso_gh,
    SEGREDO_CACHE   => "$T/cache",
    SEGREDO_SECRETS => "$T/secrets",
    SEGREDO_RAIZ    => "$T/repos",
  );
  $CACHE = "$T/cache"; $SECRETS = "$T/secrets"; $RAIZ = "$T/repos";

  my $nao_vaza = sub {
    my ($saida) = @_;
    return !grep { index($saida, $_) >= 0 } ($falso_gh, $falso_auth, $falso_pg, $falso_bi);
  };

  my ($s) = roda_como_o_claude('env', $T);
  caso('env sai com o valor trocado', $nao_vaza->($s) && $s =~ /^GITHUB_TOKEN=<oculto:GITHUB_TOKEN>$/m);
  ($s) = roda_como_o_claude('printenv', $T);
  caso('printenv sai com o valor trocado', $nao_vaza->($s) && $s =~ /<oculto:GITHUB_TOKEN>/);
  ($s) = roda_como_o_claude("cat $env_bi", $T);
  caso('cat .env troca o segredo e a senha da URL',
    $nao_vaza->($s) && $s =~ /^BETTER_AUTH_SECRET=<oculto:BETTER_AUTH_SECRET>$/m
      && $s =~ m{^DATABASE_URL=postgres://bi:<oculto:DATABASE_URL>\@127\.0\.0\.1}m);
  caso('cat .env deixa o que não é segredo como está',
    $s =~ m{^BETTER_AUTH_URL=http://localhost:3000$}m && $s =~ /^PORT=3000$/m && index($s, $publicada) >= 0);
  ($s) = roda_como_o_claude("sed -n p $T/secrets", $T);
  caso('sed -n p ~/.secrets sai com o valor trocado', $nao_vaza->($s) && $s =~ /<oculto:GITHUB_TOKEN>/ && $s =~ /<oculto:BI_MCP_PG_URL>/);
  ($s) = roda_como_o_claude('echo $GITHUB_TOKEN', $T);
  caso('echo $GITHUB_TOKEN sai com o valor trocado', $s eq "<oculto:GITHUB_TOKEN>\n");
  ($s) = roda_como_o_claude('env | grep GIT', $T);
  caso('o env | grep GIT de 02/10/2026 sai com o valor trocado', $nao_vaza->($s) && $s =~ /<oculto:GITHUB_TOKEN>/);
  ($s) = roda_como_o_claude("sed -n '1,20p' $env_bi", $T);
  caso('o sed do .env de 02/10/2026 sai com o valor trocado', $nao_vaza->($s) && $s =~ /<oculto:BETTER_AUTH_SECRET>/);

  my $outro_gh = 'ghp_' . ('Outro1' x 6);
  ($s) = roda_como_o_claude("echo $outro_gh sk-ant-api03-falsofalsofalsofalso AKIAFALSOFALSO123456 xoxb-falso-falso-falso", $T);
  caso('o formato conhecido sai trocado mesmo fora da lista',
    $s eq "<oculto:github> <oculto:anthropic> <oculto:aws> <oculto:slack>\n");

  my ($saida, $codigo, $onde) = roda_como_o_claude('cd sub', "$T/repos/bi");
  caso('o cd persiste', $codigo == 0 && $onde eq Cwd::abs_path("$T/repos/bi/sub"));
  (undef, $codigo) = roda_como_o_claude('false', $T);
  caso('o código de saída do comando continua o mesmo', $codigo == 1);
  ($saida, $codigo) = roda_como_o_claude('echo antes; exit 3', $T);
  caso("o exit no meio guarda o código e a saída (código $codigo, " . length($saida) . ' bytes)', $codigo == 3 && $saida eq "antes\n");

  my $sem = q{printf 'a\tb\r\nlinha sem fim'; printf '\000\377\n'; seq 1 200000; echo erro >&2};
  my ($puro) = roda('', $T, 'zsh', '-f', '-c', $sem);
  ($saida) = roda_como_o_claude($sem, $T);
  caso('comando sem segredo sai byte a byte igual', $saida eq $puro && length($puro) > 1_000_000);

  my (undef, undef, undef, $resposta) = roda_como_o_claude('echo $GITHUB_TOKEN', $T, 'default');
  caso('fora do bypass o Bash não é reescrito', $resposta eq '');

  my $post = sub {
    my ($ferramenta, $resposta_da_ferramenta) = @_;
    my ($r) = roda(json()->encode({ tool_name => $ferramenta, tool_input => {}, tool_response => $resposta_da_ferramenta }), undef, $^X, $SELF, 'post');
    return $r eq '' ? undef : json()->decode($r)->{hookSpecificOutput};
  };
  my $lido = { type => 'text', file => { filePath => $env_bi, content => "BETTER_AUTH_SECRET=$falso_auth\n", numLines => 1 } };
  my $h = $post->('Read', $lido);
  caso('a rede troca o valor na saída do Read, com a mesma forma',
    $h && $h->{updatedToolOutput}{file}{content} eq "BETTER_AUTH_SECRET=<oculto:BETTER_AUTH_SECRET>\n"
      && $h->{updatedToolOutput}{file}{numLines} == 1 && $h->{additionalContext} =~ /BETTER_AUTH_SECRET/);
  caso('a rede não mexe na saída sem segredo', !defined $post->('Read', { type => 'text', file => { content => 'PORT=3000' } }));
  $h = $post->('mcp__banco__query', [{ type => 'text', text => "url $falso_gh" }]);
  caso('na saída de MCP a troca mantém a lista de blocos',
    $h && $h->{updatedToolOutput}[0]{text} eq 'url <oculto:GITHUB_TOKEN>' && $h->{updatedToolOutput}[0]{type} eq 'text');

  # O Claude Code confere o old_string contra o arquivo antes do PreToolUse, e por isso a troca de
  # volta só alcança o texto novo: o new_string do Edit e o content do Write.
  my $edita = sub {
    my ($arq, $novo) = @_;
    my ($r) = roda(json()->encode({ tool_name => 'Edit', tool_input => { file_path => $arq, old_string => 'PORT=3000', new_string => $novo } }), undef, $^X, $SELF, 'pre');
    return $r eq '' ? undef : json()->decode($r)->{hookSpecificOutput}{updatedInput};
  };
  my $u = $edita->($env_bi, "PORT=3000\nCOPIA=<oculto:BETTER_AUTH_SECRET>");
  caso('o Edit de .env recebe de volta o valor escondido', $u && $u->{new_string} eq "PORT=3000\nCOPIA=$falso_auth" && $u->{old_string} eq 'PORT=3000' && $u->{file_path} eq $env_bi);
  caso('o Edit de arquivo comum não troca nada', !defined $edita->("$T/repos/bi/notas.md", 'COPIA=<oculto:BETTER_AUTH_SECRET>'));

  caso('a lista mora num arquivo de modo 600', ((stat "$T/cache/valores")[2] & 0777) == 0600);
  open my $fh, '>>', $env_bi;
  print $fh "NOVO_TOKEN=$falso_novo\n";
  close $fh;
  utime time + 2, time + 2, $env_bi;
  ($s) = roda_como_o_claude("cat $env_bi", $T);
  caso('a lista se refaz quando o .env muda', index($s, $falso_novo) < 0 && $s =~ /<oculto:NOVO_TOKEN>/);

  # O custo é medido no caminho que toda chamada paga: o hook do PreToolUse, o filtro e a rede.
  my $vezes = 20;
  my $t0 = Time::HiRes::time();
  roda('', $T, 'zsh', '-f', '-c', 'eval "$1"', 'zsh', 'true') for 1 .. $vezes;
  my $antes = (Time::HiRes::time() - $t0) / $vezes;
  $t0 = Time::HiRes::time();
  for (1 .. $vezes) {
    roda_como_o_claude('true', $T);
    $post->('Bash', { stdout => '', stderr => '', interrupted => JSON::PP::false() });
  }
  my $depois = (Time::HiRes::time() - $t0) / $vezes;
  my $soma = ($depois - $antes) * 1000;
  printf "custo  %.0f ms antes, %.0f ms depois, %.0f ms somados por chamada\n", $antes * 1000, $depois * 1000, $soma;
  caso('o hook soma menos de 50 ms a uma chamada', $soma < 50);

  printf "%s  %d de %d casos\n", ($falhas ? 'reprovou' : 'passou'), $casos - $falhas, $casos;
  exit($falhas ? 1 : 0);
}

my $modo = shift @ARGV // '';
if    ($modo eq 'pre')     { pre() }
elsif ($modo eq 'post')    { post() }
elsif ($modo eq 'filtro')  { filtro(@ARGV) }
elsif ($modo eq 'espera')  { espera(@ARGV) }
elsif ($modo eq '--teste') { teste() }
else  { print STDERR "uso: segredo.pl pre|post|--teste\n"; exit 2 }
exit 0;
