#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Markdown Preview Pro - VS Code Extension Installer
# Usage: curl -sSL https://raw.githubusercontent.com/luongnv89/vscode-markdown-preview/main/install.sh | bash
#    or: wget -qO- https://raw.githubusercontent.com/luongnv89/vscode-markdown-preview/main/install.sh | bash
# ============================================================================

# --- Configuration ---
TOOL_NAME="markdown-preview-pro"
DISPLAY_NAME="Markdown Preview Pro"
REPO_OWNER="luongnv89"
REPO_NAME="vscode-markdown-preview"
DEFAULT_BRANCH="main"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
MIN_NODE_VERSION=18
MIN_VSCODE_VERSION="1.85.0"

# --- Color Output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { printf "${BLUE}[INFO]${NC}  %s\n" "$*"; }
ok()    { printf "${GREEN}[ OK ]${NC}  %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
err()   { printf "${RED}[ERR ]${NC}  %s\n" "$*" >&2; }
die()   { err "$@"; exit 1; }
step()  { printf "\n${CYAN}==>${NC} %s\n" "$*"; }

# --- OS / Arch Detection ---
detect_os() {
    local os
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    case "$os" in
        linux*)  echo "linux" ;;
        darwin*) echo "macos" ;;
        mingw*|msys*|cygwin*) echo "windows" ;;
        *)       die "Unsupported operating system: $os" ;;
    esac
}

detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64)  echo "x86_64" ;;
        aarch64|arm64) echo "arm64" ;;
        armv7l)        echo "armv7" ;;
        *)             die "Unsupported architecture: $arch" ;;
    esac
}

detect_package_manager() {
    if command -v apt-get &>/dev/null; then echo "apt"
    elif command -v dnf &>/dev/null; then echo "dnf"
    elif command -v yum &>/dev/null; then echo "yum"
    elif command -v pacman &>/dev/null; then echo "pacman"
    elif command -v brew &>/dev/null; then echo "brew"
    elif command -v zypper &>/dev/null; then echo "zypper"
    else echo "unknown"
    fi
}

need_sudo() {
    if [ "$(id -u)" -ne 0 ]; then
        if command -v sudo &>/dev/null; then
            echo "sudo"
        else
            echo ""
        fi
    else
        echo ""
    fi
}

# --- Version Comparison ---
version_gte() {
    # Returns 0 if $1 >= $2
    printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

# --- Dependency Checks ---
check_git() {
    if ! command -v git &>/dev/null; then
        return 1
    fi
    ok "git $(git --version | awk '{print $3}')"
    return 0
}

check_node() {
    if ! command -v node &>/dev/null; then
        return 1
    fi
    local node_ver
    node_ver="$(node --version | sed 's/^v//')"
    local major
    major="$(echo "$node_ver" | cut -d. -f1)"
    if [ "$major" -lt "$MIN_NODE_VERSION" ]; then
        warn "Node.js $node_ver found, but >= $MIN_NODE_VERSION required"
        return 1
    fi
    ok "Node.js v${node_ver}"
    return 0
}

check_npm() {
    if ! command -v npm &>/dev/null; then
        return 1
    fi
    ok "npm $(npm --version)"
    return 0
}

check_vscode() {
    if command -v code &>/dev/null; then
        local vs_ver
        vs_ver="$(code --version 2>/dev/null | head -1 || echo "unknown")"
        ok "VS Code ${vs_ver}"
        return 0
    elif command -v code-insiders &>/dev/null; then
        local vs_ver
        vs_ver="$(code-insiders --version 2>/dev/null | head -1 || echo "unknown")"
        ok "VS Code Insiders ${vs_ver}"
        return 0
    elif command -v codium &>/dev/null; then
        local vs_ver
        vs_ver="$(codium --version 2>/dev/null | head -1 || echo "unknown")"
        ok "VSCodium ${vs_ver}"
        return 0
    fi
    return 1
}

get_code_cmd() {
    if command -v code &>/dev/null; then echo "code"
    elif command -v code-insiders &>/dev/null; then echo "code-insiders"
    elif command -v codium &>/dev/null; then echo "codium"
    else echo ""
    fi
}

# --- Install Dependencies ---
install_git() {
    local pm="$1"
    local sudo_cmd="$2"
    info "Installing git..."
    case "$pm" in
        apt)    $sudo_cmd apt-get update -qq && $sudo_cmd apt-get install -y -qq git ;;
        dnf)    $sudo_cmd dnf install -y -q git ;;
        yum)    $sudo_cmd yum install -y -q git ;;
        pacman) $sudo_cmd pacman -Sy --noconfirm git ;;
        brew)   brew install git ;;
        zypper) $sudo_cmd zypper install -y git ;;
        *)      die "Cannot install git: unsupported package manager '$pm'. Please install git manually." ;;
    esac
    ok "git installed"
}

install_node() {
    local os="$1"
    local pm="$2"
    local sudo_cmd="$3"
    info "Installing Node.js >= ${MIN_NODE_VERSION}..."

    case "$os" in
        macos)
            if [ "$pm" = "brew" ]; then
                brew install node
            else
                die "Please install Homebrew first: https://brew.sh"
            fi
            ;;
        linux)
            # Use NodeSource for a recent Node.js version
            if [ "$pm" = "apt" ]; then
                info "Using NodeSource repository for Node.js ${MIN_NODE_VERSION}.x..."
                curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE_VERSION}.x" | $sudo_cmd bash -
                $sudo_cmd apt-get install -y -qq nodejs
            elif [ "$pm" = "dnf" ] || [ "$pm" = "yum" ]; then
                curl -fsSL "https://rpm.nodesource.com/setup_${MIN_NODE_VERSION}.x" | $sudo_cmd bash -
                $sudo_cmd ${pm} install -y nodejs
            elif [ "$pm" = "pacman" ]; then
                $sudo_cmd pacman -Sy --noconfirm nodejs npm
            elif [ "$pm" = "brew" ]; then
                brew install node
            else
                die "Cannot install Node.js: unsupported package manager '$pm'. Please install Node.js >= $MIN_NODE_VERSION manually: https://nodejs.org"
            fi
            ;;
        *)
            die "Please install Node.js >= $MIN_NODE_VERSION manually: https://nodejs.org"
            ;;
    esac
    ok "Node.js installed"
}

install_vscode() {
    local os="$1"
    local pm="$2"
    local sudo_cmd="$3"
    warn "VS Code is not installed."
    info "Please install VS Code from: https://code.visualstudio.com/download"

    case "$os" in
        macos)
            if [ "$pm" = "brew" ]; then
                info "Or install via Homebrew:"
                printf "  ${CYAN}brew install --cask visual-studio-code${NC}\n"
            fi
            ;;
        linux)
            if [ "$pm" = "apt" ]; then
                info "Or install via snap:"
                printf "  ${CYAN}sudo snap install code --classic${NC}\n"
            fi
            ;;
    esac

    printf "\n"
    read -rp "Would you like to continue anyway (install extension files only)? [y/N] " response
    case "$response" in
        [yY][eE][sS]|[yY]) return 0 ;;
        *) die "VS Code is required. Please install it and re-run this script." ;;
    esac
}

# --- Main Installation ---
install_extension() {
    local tmpdir
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' EXIT

    step "Cloning repository..."
    git clone --depth 1 --branch "$DEFAULT_BRANCH" "$REPO_URL" "$tmpdir/ext" 2>&1 | tail -1
    ok "Repository cloned"

    step "Installing npm dependencies..."
    cd "$tmpdir/ext"
    npm install --no-fund --no-audit 2>&1 | tail -3
    ok "Dependencies installed"

    step "Building extension..."
    npx webpack --mode production 2>&1 | grep "compiled"
    ok "Extension built"

    step "Packaging extension..."
    # Install vsce if not available
    if ! command -v vsce &>/dev/null && ! npx --yes @vscode/vsce --version &>/dev/null 2>&1; then
        npm install -g @vscode/vsce 2>/dev/null || true
    fi
    npx --yes @vscode/vsce package --no-dependencies 2>&1 | tail -1
    ok "Extension packaged"

    local vsix_file
    vsix_file="$(ls -1 *.vsix 2>/dev/null | head -1)"
    if [ -z "$vsix_file" ]; then
        die "VSIX file not found after packaging"
    fi

    local code_cmd
    code_cmd="$(get_code_cmd)"
    if [ -n "$code_cmd" ]; then
        step "Installing extension into VS Code..."
        $code_cmd --install-extension "$vsix_file" --force 2>&1
        ok "Extension installed"
    else
        warn "VS Code CLI not found. The VSIX file has been built."
        info "To install manually:"
        printf "  1. Open VS Code\n"
        printf "  2. Press Ctrl+Shift+P (Cmd+Shift+P on macOS)\n"
        printf "  3. Type 'Install from VSIX'\n"
        printf "  4. Select the .vsix file\n"
    fi

    cd - >/dev/null
}

# --- Verification ---
verify_installation() {
    local code_cmd
    code_cmd="$(get_code_cmd)"
    if [ -z "$code_cmd" ]; then
        warn "Cannot verify: VS Code CLI not found"
        return 0
    fi

    info "Verifying installation..."
    if $code_cmd --list-extensions 2>/dev/null | grep -qi "markdown-preview-pro"; then
        ok "${DISPLAY_NAME} is installed and ready"
        return 0
    else
        warn "Extension not found in VS Code extension list."
        info "You may need to restart VS Code for the extension to appear."
        return 0
    fi
}

# --- Entry Point ---
main() {
    printf "\n"
    printf "${GREEN}  ╔══════════════════════════════════════╗${NC}\n"
    printf "${GREEN}  ║   ${NC}${CYAN}Markdown Preview Pro${NC}${GREEN}  Installer   ║${NC}\n"
    printf "${GREEN}  ╚══════════════════════════════════════╝${NC}\n"
    printf "\n"

    local os arch pm sudo_cmd
    os="$(detect_os)"
    arch="$(detect_arch)"
    pm="$(detect_package_manager)"
    sudo_cmd="$(need_sudo)"

    info "OS: $os | Arch: $arch | Package Manager: $pm"
    printf "\n"

    # --- Check prerequisites ---
    step "Checking prerequisites..."

    # Git
    if ! check_git; then
        install_git "$pm" "$sudo_cmd"
    fi

    # Node.js
    if ! check_node; then
        install_node "$os" "$pm" "$sudo_cmd"
        # Re-check after install
        check_node || die "Node.js installation failed"
    fi

    # npm
    if ! check_npm; then
        die "npm not found. It should have been installed with Node.js."
    fi

    # VS Code
    if ! check_vscode; then
        install_vscode "$os" "$pm" "$sudo_cmd"
    fi

    # --- Install extension ---
    install_extension

    # --- Verify ---
    verify_installation

    printf "\n"
    printf "${GREEN}  ╔══════════════════════════════════════╗${NC}\n"
    printf "${GREEN}  ║     ${NC}Installation complete! ${GREEN}           ║${NC}\n"
    printf "${GREEN}  ╚══════════════════════════════════════╝${NC}\n"
    printf "\n"
    info "Open a .md file in VS Code and press ${CYAN}Cmd+Shift+V${NC} (macOS) or ${CYAN}Ctrl+Shift+V${NC} (Linux/Windows) to preview."
    printf "\n"
}

main "$@"
