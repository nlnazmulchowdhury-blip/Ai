param(
  [string]$Action = "list",
  [string]$Path = "",
  [string]$Arg1 = "",
  [string]$Arg2 = ""
)

# win_tools.ps1 — helper for the PC agent (no-API, verified results)
# Actions: list | shot | pick | mouse:<move|click|double|right|drag|scroll|pos> | key:type | key:press | app:find | win:activate
# Mouse/keyboard use Win32 SendInput, so real apps receive real events.

if ($Action -eq "list") {
  Get-Process | Where-Object { $_.MainWindowTitle } |
    Select-Object ProcessName, MainWindowTitle |
    ConvertTo-Json -Compress
} elseif ($Action -eq "shot") {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Output "saved:$Path"
} elseif ($Action -eq "shot:crop") {
  # Arg1 = "x,y,w,h" — ছবির সমন্বয় (ভার্চুয়াল-স্ক্রিনের উপর-বাম কোণ থেকে), স্ক্রিনের সেই অংশটুকুই তোলে
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $p = $Arg1 -split ","
  if ($p.Count -lt 4) { Write-Output "fail bad rect: $Arg1"; exit 1 }
  $x = [int]$p[0]; $y = [int]$p[1]; $w = [int]$p[2]; $h = [int]$p[3]
  if ($w -lt 8) { $w = 8 }
  if ($h -lt 8) { $h = 8 }
  if ($x -lt 0) { $x = 0 }
  if ($y -lt 0) { $y = 0 }
  if ($x + $w -gt $b.Width) { $w = $b.Width - $x }
  if ($y + $h -gt $b.Height) { $h = $b.Height - $y }
  if ($w -lt 1 -or $h -lt 1) { Write-Output "fail rect off screen: $Arg1"; exit 1 }
  $rect = New-Object System.Drawing.Rectangle ($b.X + $x), ($b.Y + $y), $w, $h
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rect.Location, [System.Drawing.Point]::Empty, $rect.Size)
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  # ভার্চুয়াল-স্ক্রিনের উপর-বাম কোণও ফেরত দিই — ছবির সমন্বয় থেকে আসল স্ক্রিন সমন্বয় বের করার জন্য
  Write-Output "saved|$Path|$($b.X),$($b.Y)"
} elseif ($Action -eq "pick") {
  # পুরো স্ক্রিন জুড়ে স্নিপিং ওভারলে: Arg1 = mode (region|point|window), Arg2 = সেকেন্ড টাইমআউট
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $g.Dispose()
  if ($Path) { try { $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png) } catch { } }

  if (-not ("SnipForm" -as [type])) {
    Add-Type -ReferencedAssemblies @("System.Windows.Forms", "System.Drawing") -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public class SnipForm : Form {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  // CharSet.Unicode ছাড়া বাংলা উইন্ডো-টাইটেল ভেঙে যায়
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetWindowAttributeI(IntPtr h, int attr, out int val, int size);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetWindowAttributeRect(IntPtr h, int attr, out RECT val, int size);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  static public string Out = "";
  Bitmap shot; Rectangle vb; string mode;
  Point a, c; bool drag; Rectangle hover; IntPtr hoverH = IntPtr.Zero; string hoverT = "";
  System.Windows.Forms.Timer keep, kill; Font font;
  // \u-এস্কেপ: Windows PowerShell BOM-বিহীন ফাইল ANSI পড়ে — সরাসরি বাংলা লিখলেই ভেঙে যাবে
  static readonly string Hint = "\u099F\u09C7\u09A8\u09C7 \u0998\u09C7\u09B0\u09CB \u00B7 \u0995\u09CD\u09B2\u09BF\u0995\u09C7 \u09AA\u09C1\u09B0\u09CB \u0989\u0987\u09A8\u09CD\u09A1\u09CB \u00B7 Esc \u09AC\u09BE\u09A4\u09BF\u09B2";

  public SnipForm(Bitmap s, Rectangle bounds, string m, int secs) {
    shot = s; vb = bounds; mode = m;
    FormBorderStyle = FormBorderStyle.None;
    StartPosition = FormStartPosition.Manual;
    Bounds = vb;
    TopMost = true; ShowInTaskbar = false; MinimizeBox = false;
    Cursor = Cursors.Cross; KeyPreview = true; DoubleBuffered = true;
    AutoScaleMode = AutoScaleMode.None;
    font = MakeFont();
    keep = new System.Windows.Forms.Timer(); keep.Interval = 200;
    // হ্যাটের ওয়াচডগ প্রতি ৮০০ms-এ নিজেকে TOPMOST করে — ওটা আগে বাড়লে পিকার ঢুকে যায়, তাই নিজে বার বার আগে আসি
    keep.Tick += delegate { SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x1 | 0x2 | 0x10); };
    keep.Start();
    kill = new System.Windows.Forms.Timer(); kill.Interval = Math.Max(5, secs) * 1000;
    kill.Tick += delegate { Finish("cancel|timeout"); };
    kill.Start();
  }

  static Font MakeFont() {
    string[] fams = new string[] { "Nirmala UI", "Vrinda", "Shruti" };
    foreach (string f in fams) {
      try { Font x = new Font(f, 13f); if (x.FontFamily.Name == f) return x; x.Dispose(); } catch { }
    }
    return new Font(FontFamily.GenericSansSerif, 13f);
  }

  static Rectangle Norm(Point p, Point q) {
    return new Rectangle(Math.Min(p.X, q.X), Math.Min(p.Y, q.Y), Math.Abs(p.X - q.X), Math.Abs(p.Y - q.Y));
  }

  Rectangle WindowAt(int sx, int sy) {
    uint mine = GetCurrentProcessId();
    IntPtr best = IntPtr.Zero;
    EnumProc cb = delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == mine) return true;
      StringBuilder sb = new StringBuilder(4);
      if (GetWindowTextW(h, sb, sb.Capacity) <= 0) return true;   // টাইটেল-বিহীন = ডেস্কটপ/টাস্কবার
      RECT r; if (!GetWindowRect(h, out r)) return true;
      if (sx < r.Left || sx >= r.Right || sy < r.Top || sy >= r.Bottom) return true;
      int cloaked = 0;
      if (DwmGetWindowAttributeI(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      best = h; return false;                                     // EnumWindows z-order-এ উপর থেকে নিচে
    };
    EnumWindows(cb, IntPtr.Zero);
    if (best == IntPtr.Zero) { hoverH = IntPtr.Zero; hoverT = ""; return Rectangle.Empty; }
    hoverH = best;
    RECT rr; GetWindowRect(best, out rr);
    int L = rr.Left, T = rr.Top, R = rr.Right, B = rr.Bottom;
    RECT ext;
    // DWMWA_EXTENDED_FRAME_BOUNDS (8): GetWindowRect-এর ছায়া-সহ মাপের বদলে আসল ফ্রেম
    if (DwmGetWindowAttributeRect(best, 8, out ext, Marshal.SizeOf(typeof(RECT))) == 0) {
      L = ext.Left; T = ext.Top; R = ext.Right; B = ext.Bottom;
    }
    return new Rectangle(L - vb.X, T - vb.Y, R - L, B - T);
  }

  void Finish(string r) {
    Out = r; keep.Stop(); kill.Stop(); Close();
  }

  protected override void OnMouseDown(MouseEventArgs e) {
    if (e.Button == MouseButtons.Right) { Finish("cancel|right"); return; }
    a = e.Location; c = e.Location; drag = true; Invalidate();
  }

  protected override void OnMouseMove(MouseEventArgs e) {
    c = e.Location;
    hover = WindowAt(e.X + vb.X, e.Y + vb.Y);
    hoverT = TitleOf(hoverH);
    Invalidate();
  }

  protected override void OnMouseUp(MouseEventArgs e) {
    if (!drag) return;
    drag = false;
    Rectangle r = Norm(a, e.Location);
    bool shift = (ModifierKeys & Keys.Shift) == Keys.Shift;
    if (r.Width < 10 || r.Height < 10) {
      if (mode == "point" || shift) { Finish("point|" + e.X + "," + e.Y); return; }
      if (hover.Width > 4 && hover.Height > 4) {
        Finish("win|" + hover.X + "," + hover.Y + "," + hover.Width + "," + hover.Height + "|" + TitleOf(hoverH));
        return;
      }
      Finish("point|" + e.X + "," + e.Y);
      return;
    }
    Finish("rect|" + r.X + "," + r.Y + "," + r.Width + "," + r.Height);
  }

  // আলাদা করে আবার EnumWindows চালালে অন্য উইন্ডো ধরতে পারে — যে হ্যান্ডেলটা hover-এ পেয়েছি তার টাইটেলই নিই
  string TitleOf(IntPtr h) {
    if (h == IntPtr.Zero) return "";
    StringBuilder sb = new StringBuilder(512);
    if (GetWindowTextW(h, sb, sb.Capacity) <= 0) return "";
    string t = sb.ToString().Replace("|", " ");
    t = t.Replace("\r", " ").Replace("\n", " ").Trim();
    // বাহ্যিক কন্ট্রোল/টুলটিপের খালি-মতো টাইটেল এজেন্টকে উল্টো বোঝায়
    bool junk = true;
    foreach (char ch in t) if (char.IsLetterOrDigit(ch)) { junk = false; break; }
    return junk ? "" : t;
  }

  protected override void OnKeyDown(KeyEventArgs e) {
    if (e.KeyCode == Keys.Escape) { Finish("cancel|esc"); return; }
    if (e.KeyCode == Keys.Enter && hover.Width > 4 && hover.Height > 4) {
      Finish("win|" + hover.X + "," + hover.Y + "," + hover.Width + "," + hover.Height + "|" + TitleOf(hoverH));
    }
  }

  protected override void OnPaint(PaintEventArgs e) {
    Graphics g = e.Graphics;
    g.InterpolationMode = InterpolationMode.NearestNeighbor;
    g.PixelOffsetMode = PixelOffsetMode.Half;
    Rectangle full = new Rectangle(0, 0, vb.Width, vb.Height);
    g.DrawImage(shot, full);
    Rectangle r = drag ? Norm(a, c) : hover;
    bool has = r.Width > 1 && r.Height > 1;
    using (SolidBrush dim = new SolidBrush(Color.FromArgb(140, 0, 0, 0))) {
      if (has) {
        // Region/SetClip এই অ্যাসেম্বলি সেটে কম্পাইল হয় না — বাইরের চারপাশটা ৪টা স্ট্রিপ দিয়ে ঘেরা হয়
        g.FillRectangle(dim, 0, 0, vb.Width, r.Top);
        g.FillRectangle(dim, 0, r.Bottom, vb.Width, vb.Height - r.Bottom);
        g.FillRectangle(dim, 0, r.Top, r.Left, r.Height);
        g.FillRectangle(dim, r.Right, r.Top, vb.Width - r.Right, r.Height);
      } else {
        g.FillRectangle(dim, full);
      }
    }
    if (has) {
      using (Pen p = new Pen(Color.FromArgb(255, 91, 157, 255), 2)) g.DrawRectangle(p, r.X, r.Y, Math.Max(1, r.Width - 1), Math.Max(1, r.Height - 1));
      string tag = drag || hoverT.Length == 0 ? r.Width + "\u00D7" + r.Height : hoverT;
      if (tag.Length > 58) tag = tag.Substring(0, 58) + "...";
      DrawTag(g, tag, r.X + 2, r.Y - 26);
    }
    DrawTag(g, Hint, (vb.Width - 470) / 2, 14);
  }

  void DrawTag(Graphics g, string text, int x, int y) {
    Size s = TextRenderer.MeasureText(g, text, font, new Size(1400, 200), TextFormatFlags.NoPrefix);
    Rectangle box = new Rectangle(Math.Max(2, x), Math.Max(2, y), s.Width + 14, s.Height + 8);
    using (SolidBrush bg = new SolidBrush(Color.FromArgb(215, 5, 8, 14))) g.FillRectangle(bg, box);
    using (Pen p = new Pen(Color.FromArgb(90, 91, 157, 255))) g.DrawRectangle(p, box.X, box.Y, box.Width - 1, box.Height - 1);
    TextRenderer.DrawText(g, text, font, new Point(box.X + 7, box.Y + 4), Color.FromArgb(232, 240, 255), Color.Transparent, TextFormatFlags.NoPrefix);
  }
}
'@
  }

  $mode = 'region'
  if ($Arg1) { $mode = $Arg1 }
  $secs = 60
  if ($Arg2) { $secs = [int]$Arg2 }
  [SnipForm]::Out = ""
  $form = New-Object SnipForm ($bmp, $b, $mode, $secs)
  [System.Windows.Forms.Application]::Run($form)
  $bmp.Dispose()
  Write-Output "origin|$($b.X),$($b.Y)"
  Write-Output ([SnipForm]::Out)
} elseif ($Action -like "mouse:*" -or $Action -like "key:*" -or $Action -like "app:*" -or $Action -like "win:*") {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  if (-not ("AgentInput" -as [type])) {
    Add-Type -ReferencedAssemblies @("System.Windows.Forms", "System.Drawing") -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Drawing;

public struct AgentINPUT {
    public uint type;
    public uint pad0;
    [MarshalAs(UnmanagedType.Struct)]
    public AgentInputUnion u;
}

[StructLayout(LayoutKind.Explicit)]
public struct AgentInputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
}

[StructLayout(LayoutKind.Sequential)]
public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
}

[StructLayout(LayoutKind.Sequential)]
public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
}

public static class AgentInput {
    const uint INPUT_MOUSE = 0;
    const uint INPUT_KEYBOARD = 1;
    const uint MOVE = 0x0001, DOWN = 0x0002, UP = 0x0004;
    const uint WKDOWN = 0x0008, WKUP = 0x0002; // KEYEVENTF_KEYUP (was wrongly 0x0010, so keys never released)
    const uint HWHEEL = 0x1000, VHWHEEL = 0x2000;
    const uint ABSOLUTE = 0x8000, VIRTUALKEY = 0x0004, UNICODEKEY = 0x0004, EXTENDEDKEY = 0x0001;

    static bool IsExtended(ushort vk) {
        return vk == 0x2D || vk == 0x2E || vk == 0x24 || vk == 0x23 || vk == 0x21 || vk == 0x22 ||
               (vk >= 0x25 && vk <= 0x28) || vk == 0x2C || (vk >= 0x6F && vk <= 0x78) || vk == 0x5B || vk == 0x5C ||
               (vk >= 0xAD && vk <= 0xB3);
    }

    [DllImport("user32.dll")]
    static extern uint MapVirtualKey(uint code, uint mapType);

    static AgentINPUT Key(ushort vk, uint flags) {
        AgentINPUT i = new AgentINPUT();
        i.type = INPUT_KEYBOARD;
        i.u.ki.wVk = vk;
        // Qt-based apps (Resolve, Adobe) read the hardware scan code; without it keys are dropped
        i.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
        i.u.ki.dwFlags = flags | (IsExtended(vk) ? EXTENDEDKEY : 0);
        return i;
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, [MarshalAs(UnmanagedType.LPArray), In] AgentINPUT[] pInputs, int cbSize);

    static AgentINPUT Mouse(int dx, int dy, uint data, uint flags) {
        AgentINPUT i = new AgentINPUT();
        i.type = INPUT_MOUSE;
        i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = data; i.u.mi.dwFlags = flags;
        return i;
    }

    static AgentINPUT KeyChar(ushort ch) {
        AgentINPUT i = new AgentINPUT();
        i.type = INPUT_KEYBOARD;
        i.u.ki.wScan = ch;
        i.u.ki.dwFlags = UNICODEKEY;
        return i;
    }

    static void Send(AgentINPUT[] arr) {
        int size = Marshal.SizeOf(typeof(AgentINPUT));
        uint done = SendInput((uint)arr.Length, arr, size);
        if (done != (uint)arr.Length) throw new Exception("SendInput failed: " + Marshal.GetLastWin32Error());
    }

    public static void MoveTo(int x, int y) {
        int w = System.Windows.Forms.Screen.PrimaryScreen.Bounds.Width;
        int h = System.Windows.Forms.Screen.PrimaryScreen.Bounds.Height;
        int nx = x * 65535 / Math.Max(1, w);
        int ny = y * 65535 / Math.Max(1, h);
        Send(new AgentINPUT[] { Mouse(nx, ny, 0, MOVE | ABSOLUTE) });
    }

    public static uint DebugMove(int x, int y) {
        AgentINPUT[] a = new AgentINPUT[1];
        a[0] = Mouse(x, y, 0, MOVE | ABSOLUTE);
        int size = Marshal.SizeOf(typeof(AgentINPUT));
        uint ret = SendInput(1, a, size);
        if (ret != 1) throw new Exception("ret=" + ret + " err=" + Marshal.GetLastWin32Error() + " size=" + size);
        return ret;
    }

    public static void Click(int x, int y, string kind) {
        MoveTo(x, y);
        // flags carry the button; mouseData is only for wheel/X buttons (old code put 0x0002 there,
        // so every right-click was silently sent as a left-click)
        uint down = DOWN, up = UP;
        if (kind == "right") { down = 0x0008; up = 0x0010; }
        if (kind == "middle") { down = 0x0020; up = 0x0040; }
        if (kind == "double") {
            // two full down/up pairs in one batch = real double-click
            Send(new AgentINPUT[] {
                Mouse(0, 0, 0, down), Mouse(0, 0, 0, up),
                Mouse(0, 0, 0, down), Mouse(0, 0, 0, up)
            });
            return;
        }
        Send(new AgentINPUT[] { Mouse(0, 0, 0, down), Mouse(0, 0, 0, up) });
    }

    public static void Drag(int x1, int y1, int x2, int y2) {
        MoveTo(x1, y1);
        Send(new AgentINPUT[] { Mouse(0, 0, 0, DOWN) });
        int steps = 14;
        for (int s = 1; s <= steps; s++) {
            int nx = x1 + (x2 - x1) * s / steps;
            int ny = y1 + (y2 - y1) * s / steps;
            MoveTo(nx, ny);
            System.Threading.Thread.Sleep(18);
        }
        Send(new AgentINPUT[] { Mouse(0, 0, 0, UP) });
    }

    public static void Scroll(int amount) {
        int delta = amount * 120;
        uint flag = delta >= 0 ? VHWHEEL : HWHEEL;
        Send(new AgentINPUT[] { Mouse(0, 0, (uint)Math.Abs(delta), flag) });
    }

    public static void TypeChar(ushort ch) {
        AgentINPUT d = KeyChar(ch);
        AgentINPUT u = KeyChar(ch);
        u.u.ki.dwFlags |= WKUP;
        Send(new AgentINPUT[] { d, u });
    }

    public static void TypeText(string text) {
        foreach (char c in text) {
            if (c == '\n') { TypeChar(0x0D); continue; }
            TypeChar((ushort)c);
            System.Threading.Thread.Sleep(6);
        }
    }

    public static void Tap(ushort vk) {
        Send(new AgentINPUT[] { Key(vk, 0), Key(vk, WKUP) });
    }

    // Earlier runs could leave Shift/Alt/Ctrl logically down (bad key-up flag), so clear them first
    public static void ReleaseModifiers() {
        Send(new AgentINPUT[] { Key(0x11, WKUP), Key(0x10, WKUP), Key(0x12, WKUP), Key(0x5B, WKUP) });
    }

    public static void Combo(ushort[] vks) {
        // press all, then release in reverse
        AgentINPUT[] press = new AgentINPUT[vks.Length];
        AgentINPUT[] rel = new AgentINPUT[vks.Length];
        for (int i = 0; i < vks.Length; i++) { press[i] = Key(vks[i], 0); rel[i] = Key(vks[vks.Length - 1 - i], WKUP); }
        Send(press);
        System.Threading.Thread.Sleep(30);
        Send(rel);
    }
}

// Raise a window to the front by a piece of its title. Without this the agent's
// screenshots always show whatever the user last touched (Qoder), never the app it opened.
public static class WinAct {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr h, int idx);

    // A folder window named "DaVinci_Resolve_21.1.2_Windows_2 - File Explorer" outranks the
    // real Resolve app if only the title is compared, so shell windows are matched last.
    static bool IsShell(string cls) {
        return cls == "CabinetWClass" || cls == "ExploreWClass" || cls == "PP11" ||
               cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd" ||
               cls == "NotifyIconOverflowWindow" || cls == "Windows.UI.Core.CoreWindow";
    }

    static string TitleOf(IntPtr h) {
        int len = GetWindowTextLength(h);
        if (len <= 0) return "";
        System.Text.StringBuilder sb = new System.Text.StringBuilder(len + 2);
        if (GetWindowTextW(h, sb, sb.Capacity) <= 0) return "";
        return sb.ToString();
    }

    static string ClassOf(IntPtr h) {
        System.Text.StringBuilder sb = new System.Text.StringBuilder(256);
        if (GetClassNameW(h, sb, sb.Capacity) <= 0) return "";
        return sb.ToString();
    }

    // solo=true hides every other window so the agent's screenshots show only the target
    static int MinimizeOthers(IntPtr keep) {
        int n = 0;
        EnumProc cb = delegate (IntPtr h, IntPtr l) {
            if (h == keep) return true;
            if (!IsWindowVisible(h)) return true;
            if (IsIconic(h)) return true;
            if (TitleOf(h).Length == 0) return true;
            if (IsShell(ClassOf(h))) return true;
            // WS_EX_TOPMOST (0x8) windows are the user's overlays (agent hat, pickers) - leave them
            if ((GetWindowLongW(h, -20) & 0x8) != 0) return true;
            ShowWindow(h, 6); // SW_MINIMIZE
            n++;
            return true;
        };
        EnumWindows(cb, IntPtr.Zero);
        return n;
    }

    public static string Go(string term) { return Go(term, ""); }

    // Last successfully raised window - lets a key sequence re-check cheaply between steps
    // (Qoder/other apps can pull the foreground back mid-sequence).
    static IntPtr lastHit = IntPtr.Zero;

    public static bool StillForeground() { return lastHit != IntPtr.Zero && GetForegroundWindow() == lastHit; }

    public static string Reassert() {
        if (lastHit == IntPtr.Zero || !IsWindowVisible(lastHit)) return "fail no remembered window";
        IntPtr fg = GetForegroundWindow();
        if (fg == lastHit) return "ok already foreground";
        uint fgp; uint fgTid = GetWindowThreadProcessId(fg, out fgp);
        uint mine = GetCurrentThreadId();
        bool attached = fgTid != 0 && fgTid != mine && AttachThreadInput(mine, fgTid, true);
        AgentInput.Tap(0x12);
        BringWindowToTop(lastHit);
        SetForegroundWindow(lastHit);
        if (attached) AttachThreadInput(mine, fgTid, false);
        System.Threading.Thread.Sleep(250);
        return GetForegroundWindow() == lastHit ? "ok foreground back" : "fail foreground lost";
    }

    public static string Go(string term, string opt) {
        string want = (term == null ? "" : term).Trim().ToLower();
        if (want.Length < 2) return "fail activate needs at least 2 letters of a window title";
        IntPtr hit = IntPtr.Zero; string title = "";
        IntPtr shellHit = IntPtr.Zero; string shellTitle = "";
        EnumProc cb = delegate (IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h)) return true;
            string t = TitleOf(h);
            if (t.Length == 0) return true;
            if (!t.ToLower().Contains(want)) return true;
            if (IsShell(ClassOf(h))) {
                if (shellHit == IntPtr.Zero) { shellHit = h; shellTitle = t; }
                return true;
            }
            hit = h; title = t; return false;   // first non-shell match, z-order top-down
        };
        EnumWindows(cb, IntPtr.Zero);
        if (hit == IntPtr.Zero && shellHit != IntPtr.Zero) { hit = shellHit; title = shellTitle; }
        if (hit == IntPtr.Zero) return "fail no window with title: " + term;
        if (IsIconic(hit)) { ShowWindow(hit, 9); System.Threading.Thread.Sleep(300); } // SW_RESTORE

        // Windows foreground lock: a background process calling SetForegroundWindow alone is
        // ignored. Sharing input with the current foreground thread + a bare Alt tap lifts it.
        IntPtr fg = GetForegroundWindow();
        uint fgp; uint fgTid = GetWindowThreadProcessId(fg, out fgp);
        uint mine = GetCurrentThreadId();
        bool attached = fgTid != 0 && fgTid != mine && AttachThreadInput(mine, fgTid, true);
        AgentInput.Tap(0x12); // VK_MENU
        BringWindowToTop(hit);
        SetForegroundWindow(hit);
        if (attached) AttachThreadInput(mine, fgTid, false);
        System.Threading.Thread.Sleep(400);
        if (GetForegroundWindow() != hit) { ShowWindow(hit, 5); SetForegroundWindow(hit); System.Threading.Thread.Sleep(300); }
        if (GetForegroundWindow() != hit) return "fail foreground lock held: " + title;
        lastHit = hit;
        if (opt != null && opt.ToLower() == "solo") {
            int hid = MinimizeOthers(hit);
            SetForegroundWindow(hit);
            System.Threading.Thread.Sleep(250);
            return "ok activated " + title + " solo_minimized=" + hid;
        }
        return "ok activated " + title;
    }
}
'@
  }

  function Parse-Point([string]$s) {
    # খালি/বিকৃত Arg1 চুপচাপ [int]"" = 0 হয়ে স্ক্রিনের উপর-বাম কোণে ক্লিক করত
    $p = @($s -split ",")
    if ($p.Count -lt 2 -or $p[0].Trim() -notmatch '^-?\d+$' -or $p[1].Trim() -notmatch '^-?\d+$') {
      Write-Output "fail position must be x,y but got [$s]"
      exit 1
    }
    return @([int]$p[0].Trim(), [int]$p[1].Trim())
  }

  # "Visual Studio Code" ও "vs code" যেন এক হয় — নাম থেকে অপ্রয়োজনীয় অংশ সরিয়ে ফেলা হয়
  function NormApp([string]$s) {
    $t = $s.ToLower() -replace '[^a-z0-9]', ''
    foreach ($junk in @('visual', 'studio', 'microsoft', 'corporation', 'inc', 'app', 'apps', 'portable', 'installer', '64', '32')) {
      $t = $t.Replace($junk, '')
    }
    return $t
  }

  $VK = @{
    ctrl = 0x11; control = 0x11; alt = 0x12; menu = 0x12; shift = 0x10; win = 0x5B; cmd = 0x5B; super = 0x5B;
    enter = 0x0D; return = 0x0D; tab = 0x09; esc = 0x1B; escape = 0x1B; space = 0x20; backspace = 0x08;
    delete = 0x2E; del = 0x2E; insert = 0x2D; home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22;
    up = 0x26; down = 0x28; left = 0x25; right = 0x27; capslock = 0x14; printscreen = 0x2C;
    a = 0x41; b = 0x42; c = 0x43; d = 0x44; e = 0x45; f = 0x46; g = 0x47; h = 0x48; i = 0x49; j = 0x4A;
    k = 0x4B; l = 0x4C; m = 0x4D; n = 0x4E; o = 0x4F; p = 0x50; q = 0x51; r = 0x52; s = 0x53; t = 0x54;
    u = 0x55; v = 0x56; w = 0x57; x = 0x58; y = 0x59; z = 0x5A;
    "0" = 0x30; "1" = 0x31; "2" = 0x32; "3" = 0x33; "4" = 0x34; "5" = 0x35; "6" = 0x36; "7" = 0x37; "8" = 0x38; "9" = 0x39;
    f1 = 0x70; f2 = 0x71; f3 = 0x72; f4 = 0x73; f5 = 0x74; f6 = 0x75; f7 = 0x76; f8 = 0x77; f9 = 0x78;
    f10 = 0x79; f11 = 0x7A; f12 = 0x7B; f13 = 0x7C; f14 = 0x7D; f15 = 0x7E; f16 = 0x7F; f17 = 0x80;
    f18 = 0x81; f19 = 0x82; f20 = 0x83; f21 = 0x84; f22 = 0x85; f23 = 0x86; f24 = 0x87;
    minus = 0xBD; plus = 0xBB; comma = 0xBC; dot = 0xBE; slash = 0xBF;
    # মাল্টিমিডিয়া কী — ভলিউমের জন্য PowerShell কমান্ড আবিষ্কার করার দরকার নেই (press_keys-ই যথেষ্ট)
    volumemute = 0xAD; volumedown = 0xAE; volumeup = 0xAF;
    medianext = 0xB0; mediaprev = 0xB1; mediastop = 0xB2; mediaplaypause = 0xB3;
  }

  try {
    if ($Action -eq "mouse:debug") {
      $r = [AgentInput]::DebugMove(300, 300)
      Write-Output "ok ret=$r"
    } elseif ($Action -eq "mouse:pos") {
      $p = [System.Windows.Forms.Cursor]::Position
      Write-Output "ok x=$($p.X) y=$($p.Y)"
    } elseif ($Action -eq "mouse:move") {
      $xy = Parse-Point $Arg1
      [AgentInput]::MoveTo($xy[0], $xy[1])
      Write-Output "ok moved to $($xy[0]),$($xy[1])"
    } elseif ($Action -like "mouse:click*" -or $Action -like "mouse:double*" -or $Action -like "mouse:right*") {
      $kind = "left"
      if ($Action -like "mouse:double*") { $kind = "double" }
      if ($Action -like "mouse:right*") { $kind = "right" }
      $xy = Parse-Point $Arg1
      [AgentInput]::Click($xy[0], $xy[1], $kind)
      Start-Sleep -Milliseconds 150
      $p = [System.Windows.Forms.Cursor]::Position
      Write-Output "ok $kind click at $($p.X),$($p.Y)"
    } elseif ($Action -eq "mouse:drag") {
      $a = Parse-Point $Arg1
      $b = Parse-Point $Arg2
      [AgentInput]::Drag($a[0], $a[1], $b[0], $b[1])
      Write-Output "ok dragged $($a[0]),$($a[1]) -> $($b[0]),$($b[1])"
    } elseif ($Action -eq "mouse:scroll") {
      if ($Arg1 -match ",") { $xy = Parse-Point $Arg1; [AgentInput]::MoveTo($xy[0], $xy[1]) }
      $amt = [int]$Arg2
      if ($Arg1 -notmatch "," -and $Arg2 -eq "") { $amt = [int]$Arg1 }
      [AgentInput]::Scroll($amt)
      Write-Output "ok scrolled $amt"
    } elseif ($Action -eq "key:type") {
      if ($Arg1 -match "^file:") {
        $txt = Get-Content -Raw -Encoding UTF8 ($Arg1.Substring(5))
      } else {
        $txt = $Arg1
      }
      [AgentInput]::TypeText($txt)
      Write-Output "ok typed $($txt.Length) chars"
    } elseif ($Action -eq "key:press") {
      $parts = $Arg1.ToLower().Split("+").Trim() | Where-Object { $_ -ne "" }
      $codes = @()
      foreach ($part in $parts) {
        if ($VK.ContainsKey($part)) { $codes += [uint16]$VK[$part] }
        elseif ($part.Length -eq 1) { $codes += [uint16][char]$part.ToUpper() }
        else { throw "unknown key: $part" }
      }
      if ($codes.Count -eq 1) { [AgentInput]::Tap($codes[0]) }
      else { [AgentInput]::Combo($codes) }
      Write-Output "ok pressed $($Arg1)"
    } elseif ($Action -eq "app:find") {
      # অ্যাপের নাম (বা ভুল অনুমিত পাথের শেষ অংশ) থেকে আসল ইনস্টল করা ঠিকানা বের করা হয়
      $q = NormApp $Arg1
      $found = New-Object System.Collections.Generic.List[string]
      if ($q.Length -ge 2) {
        $sc = New-Object -ComObject WScript.Shell
        $roots = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
        foreach ($r in $roots) {
          if (-not (Test-Path $r)) { continue }
          foreach ($f in (Get-ChildItem -Path $r -Recurse -Filter *.lnk -ErrorAction SilentlyContinue)) {
            $n = NormApp $f.BaseName
            if ($n.Length -lt 2) { continue }
            if ($n -eq $q -or $n.Contains($q) -or $q.Contains($n)) {
              $t = $sc.CreateShortcut($f.FullName).TargetPath
              if ($t -and (Test-Path $t) -and (-not $found.Contains($t))) { $found.Add($t) }
            }
          }
        }
      }
      # Store/UWP অ্যাপ (নো্টপ্যাড, ক্যালকুলেটর) — শর্টকাট ফাইল নেই, তাই AppsFolder আইডি দিয়ে খোলা হয়
      if ($found.Count -eq 0 -and $q.Length -ge 2) {
        Get-StartApps -ErrorAction SilentlyContinue | Where-Object {
          $n = NormApp $_.Name
          $n.Length -ge 2 -and ($n -eq $q -or $n.Contains($q) -or $q.Contains($n))
        } | Select-Object -First 3 | ForEach-Object { $found.Add("appsfolder:" + $_.AppID) }
      }
      # PATH-এর shim (Git-এর usr\bin\notepad) আসল অ্যাপকে ঢেকে দেয় — এটাই সবশেষে বসে
      if ($found.Count -eq 0) {
        $exe = Get-Command ($Arg1 -replace '\.(exe|lnk|bat|cmd)$', '') -ErrorAction SilentlyContinue
        if ($exe -and $exe.Source -and (Test-Path $exe.Source)) { $found.Add($exe.Source) }
      }
      if ($found.Count -eq 0) { Write-Output "fail no app: $Arg1" }
      else { Write-Output ("ok " + ($found -join "|")) }
    } elseif ($Action -eq "win:activate") {
      # Arg1 = উইন্ডো-শিরোনামের অংশ, Arg2 = "solo" হলে বাকি সব উইন্ডো মিনিমাইজ
      Write-Output ([WinAct]::Go($Arg1, $Arg2))
    } elseif ($Action -eq "win:actshot") {
      # Arg1 = title, Arg2 = ";" separated key steps ("space", "shift+4", "wait:600"), $Path = png.
      # One process: focus solo, send keys, capture - no other app can steal the foreground in between.
      $res = [WinAct]::Go($Arg1, "solo")
      if (-not $res.StartsWith("ok")) { Write-Output $res; exit 1 }
      [AgentInput]::ReleaseModifiers()
      if ($Arg2) {
        foreach ($step in $Arg2.Split(";")) {
          $s = $step.Trim()
          if (-not $s) { continue }
          if ($s -like "wait:*") { Start-Sleep -Milliseconds ([int]$s.Substring(5)); continue }
          # অন্য অ্যাপ (Qoder) মাঝপথে ফোরগ্রাউন্ড কেড়ে নিতে পারে - প্রতিটি কী-র আগে ফিরিয়ে আনি, না পারলে থামি
          if (-not [WinAct]::StillForeground()) {
            $back = [WinAct]::Reassert()
            # উইন্ডো বদলে গেলে (Project Manager -> Resolve) পুরো শিরোনাম-খোঁজ আবার চালাই
            if (-not $back.StartsWith("ok")) { $back = [WinAct]::Go($Arg1, "solo") }
            if (-not $back.StartsWith("ok")) { Write-Output "fail lost focus before key '$s': $back"; exit 1 }
          }
          if ($s -like "click:*" -or $s -like "dclick:*" -or $s -like "rclick:*") {
            $kind = "left"
            $rest = $s.Substring($s.IndexOf(":") + 1)
            if ($s -like "dclick:*") { $kind = "double" }
            if ($s -like "rclick:*") { $kind = "right" }
            $xy = Parse-Point $rest
            [AgentInput]::Click($xy[0], $xy[1], $kind)
            Start-Sleep -Milliseconds 400
            continue
          }
          if ($s -like "type:*") {
            $txt = Get-Content -Raw -Encoding UTF8 ($s.Substring(5))
            [AgentInput]::TypeText($txt)
            Start-Sleep -Milliseconds 300
            continue
          }
          $parts = $s.ToLower().Split("+") | Where-Object { $_ -ne "" }
          $codes = @()
          foreach ($part in $parts) {
            if ($VK.ContainsKey($part)) { $codes += [uint16]$VK[$part] }
            elseif ($part.Length -eq 1) { $codes += [uint16][char]$part.ToUpper() }
            else { throw "unknown key: $part" }
          }
          if ($codes.Count -eq 1) { [AgentInput]::Tap($codes[0]) } else { [AgentInput]::Combo($codes) }
          Start-Sleep -Milliseconds 260
        }
      }
      Start-Sleep -Milliseconds 450
      if (-not [WinAct]::StillForeground()) {
        $back = [WinAct]::Reassert()
        if (-not $back.StartsWith("ok")) { $back = [WinAct]::Go($Arg1, "solo") }
        if (-not $back.StartsWith("ok")) { $back = [WinAct]::Go("DaVinci Resolve", "solo") }
        if (-not $back.StartsWith("ok")) { $res = "fail lost focus before capture: $back" }
        Start-Sleep -Milliseconds 300
      }
      Add-Type -AssemblyName System.Drawing
      $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
      $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose()
      $bmp.Dispose()
      Write-Output "ok $res shot:$Path"
    } else {
      Write-Output "fail unknown action: $Action"
    }
  } catch {
    Write-Output "fail $($_.Exception.Message)"
  }
}
