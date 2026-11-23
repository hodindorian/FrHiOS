# .zshrc de FrHiOS — dérivé de celui de Dorian, en version portable :
#  - gardés : oh-my-zsh, thème agnoster, plugin git, alias utiles (mises à jour pacman, ls, etc.)
#  - retirés : tout identifiant/secret, adresses de serveurs, outils de développement absents ici
#    (Flutter, Android SDK, nvm, Angular, Bun…) et alias dangereux (kill -9 -1)

export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="agnoster"
export PS1="\n$PS1"

# Le dossier oh-my-zsh est une copie sans git : pas de mises à jour automatiques
zstyle ':omz:update' mode disabled

plugins=(git)

source $ZSH/oh-my-zsh.sh

# --- Alias ---
alias ls='ls --color=auto'
alias la='ls -A'
alias ll='ls -l'
alias c='clear'
alias x='exit'
alias f5='source ~/.zshrc'
alias cl='cd;clear;f5'
alias vimzsh='vim ~/.zshrc;f5'
alias tah='tar -xzvf'
alias ga='git add .'
alias gc='git commit -m '
alias neofetch='fastfetch'

# Gestion du système (pacman)
alias upg='sudo pacman -Syyu --noconfirm'
alias dw='sudo pacman -S --noconfirm'
alias sup='sudo pacman -Rsn'
alias all='sudo pacman -R $(pacman -Qdtq) --noconfirm;upg'

# Éteindre l'appareil
alias ff+='shutdown now'

export VISUAL=vim

c
neofetch
