param([Parameter(Mandatory=$true)][int]$CandidateHostPid)
$ErrorActionPreference='Stop'
$CandidateRoot='C:\xjy-work\xjy-web-stage1'
if((Split-Path -Parent $PSScriptRoot) -ne $CandidateRoot){throw 'Fixed guest root required'}
& 'C:\Python314\python.exe' -I -B (Join-Path $PSScriptRoot 'validate-sandbox-context.py') | Out-Null
if($LASTEXITCODE -ne 0){throw 'Actual Sandbox required before any window inspection'}
$CandidatePolicies=@(Get-ExecutionPolicy -List | ForEach-Object {[pscustomobject]@{scope=[string]$_.Scope;policy=[string]$_.ExecutionPolicy}})
foreach($CandidatePolicy in $CandidatePolicies){if($CandidatePolicy.scope -eq 'Process'){if($CandidatePolicy.policy -ne 'Bypass'){throw 'Only this child process may use Bypass'}}elseif($CandidatePolicy.policy -ne 'Undefined'){throw 'Configured policy refused; no persistent policy changed'}}
if($CandidateHostPid -lt 1){throw 'Actual owned process required'}
$CandidateHost=Get-CimInstance Win32_Process -Filter ('ProcessId='+$CandidateHostPid)
$CandidateRunner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID)
$CandidateNode=Get-CimInstance Win32_Process -Filter ('ProcessId='+$CandidateRunner.ParentProcessId)
if(!$CandidateHost -or !$CandidateNode -or $CandidateHost.ParentProcessId -ne $CandidateNode.ParentProcessId){throw 'Owned sibling process chain required'}
$CandidateExe=Join-Path $CandidateRoot ('release-candidate\'+[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('6ZGr6YeR5rqQ54+g5a6d5oql5Lu3LmV4ZQ==')))
if($CandidateHost.ExecutablePath -ne $CandidateExe -or $CandidateNode.ExecutablePath -ne $CandidateExe){throw 'Exact owned original engine required'}
if((Get-FileHash -LiteralPath $CandidateExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'){throw 'Original engine hash mismatch'}
$CandidateTitle=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5oGi5aSN5Li75py65Lia5Yqh6LWE5paZ'))
$CandidateMessage=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5oGi5aSN5omA6YCJ5aSH5Lu95Lit55qE5Lia5Yqh6LWE5paZ77yf'))
$CandidateButton=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('56Gu6K6k5oGi5aSN'))
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
 Add-Type -TypeDefinition @"
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class XjyReadOwnedWindow {
 public delegate bool Callback(IntPtr w,IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb,IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr w,Callback cb,IntPtr l);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr w,StringBuilder t,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr w,StringBuilder t,int n);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr w,uint command);
 [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr w);
 [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr w,uint message,UIntPtr wp,IntPtr lp,uint flags,uint timeout,out UIntPtr result);

 public class Item {public long hwnd,owner;public uint pid;public string title,type;public bool visible;public List<Item> children;}
 static Item Read(IntPtr w){uint p;GetWindowThreadProcessId(w,out p);var t=new StringBuilder(2048);var c=new StringBuilder(256);GetWindowText(w,t,t.Capacity);GetClassName(w,c,c.Capacity);return new Item{hwnd=w.ToInt64(),owner=GetWindow(w,4).ToInt64(),pid=p,title=t.ToString(),type=c.ToString(),visible=IsWindowVisible(w)};}
 public static void Confirm(uint pid,long dialog,long button,long owner,string title,string caption){
  var d=Read(new IntPtr(dialog));var b=Read(new IntPtr(button));var o=Read(new IntPtr(owner));
  if(d.pid!=pid||b.pid!=pid||o.pid!=pid||d.owner!=owner||d.title!=title||d.type!="#32770"||b.title!=caption||b.type!="Button"||o.type!="Chrome_WidgetWin_1"||!d.visible||!b.visible||!o.visible||!IsChild(new IntPtr(dialog),new IntPtr(button))||!IsWindowEnabled(new IntPtr(button)))throw new InvalidOperationException("Owned native confirmation changed; no click performed");
  UIntPtr result;if(SendMessageTimeout(new IntPtr(button),0x00F5,UIntPtr.Zero,IntPtr.Zero,2,5000,out result)==IntPtr.Zero)throw new InvalidOperationException("Single native confirmation delivery uncertain; do not retry");
 }
 public static List<Item> Run(uint pid){var output=new List<Item>();EnumWindows((w,l)=>{uint p;GetWindowThreadProcessId(w,out p);if(p!=pid)return true;var row=Read(w);row.children=new List<Item>();EnumChildWindows(w,(c,z)=>{uint cp;GetWindowThreadProcessId(c,out cp);if(cp==pid && row.children.Count<200)row.children.Add(Read(c));return true;},IntPtr.Zero);output.Add(row);return output.Count<30;},IntPtr.Zero);return output;}
}
"@


$CandidateDeadline=[DateTime]::UtcNow.AddSeconds(40)
$CandidateClicked=$false
$CandidateDirectObservation=$null
while([DateTime]::UtcNow -lt $CandidateDeadline){
 $CandidateByPid=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$CandidateHostPid)
 $CandidateByTitle=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$CandidateTitle)
 $CandidateByWindow=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Window)
 $CandidateCondition=[System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@($CandidateByPid,$CandidateByTitle,$CandidateByWindow))
 $CandidateDialog=$null
 $OwnedNativeWindows=@([XjyReadOwnedWindow]::Run([uint32]$CandidateHostPid))
 $OwnedMainWindows=@($OwnedNativeWindows|Where-Object {$_.visible -and $_.type -ceq 'Chrome_WidgetWin_1' -and $_.owner -eq 0})
 $OwnedNativeDialogs=@($OwnedNativeWindows|Where-Object {$_.visible -and $_.type -ceq '#32770' -and $_.title -ceq $CandidateTitle -and $OwnedMainWindows.hwnd -contains $_.owner})
 if($OwnedNativeDialogs.Count -eq 1){
  $CandidateDialog=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$OwnedNativeDialogs[0].hwnd)
  if($CandidateDialog.Current.ProcessId -ne $CandidateHostPid -or $CandidateDialog.Current.Name -cne $CandidateTitle){throw 'Native and UIA dialog identity mismatch'}
  $DirectChildren=$CandidateDialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $DirectRows=@();for($DirectIndex=0;$DirectIndex -lt [Math]::Min(100,$DirectChildren.Count);$DirectIndex++){$Direct=$DirectChildren[$DirectIndex];$DirectRows+=@([pscustomobject]@{name=$Direct.Current.Name;type=$Direct.Current.ControlType.ProgrammaticName;pid=$Direct.Current.ProcessId;enabled=$Direct.Current.IsEnabled;offscreen=$Direct.Current.IsOffscreen})}
  $CandidateDirectObservation=[ordered]@{name=$CandidateDialog.Current.Name;type=$CandidateDialog.Current.ControlType.ProgrammaticName;pid=$CandidateDialog.Current.ProcessId;offscreen=$CandidateDialog.Current.IsOffscreen;children=$DirectRows}

 }
 if($CandidateDialog -and $CandidateDialog.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and !$CandidateDialog.Current.IsOffscreen){
  $CandidateTexts=$CandidateDialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$CandidateMessage))
  $CandidateNativeButtons=@($OwnedNativeDialogs[0].children|Where-Object {$_.pid -eq $CandidateHostPid -and $_.visible -and $_.type -ceq 'Button' -and $_.title -ceq $CandidateButton})
  if($CandidateTexts.Count -gt 0 -and $CandidateNativeButtons.Count -eq 1){
   $CandidateAgain=Get-CimInstance Win32_Process -Filter ('ProcessId='+$CandidateHostPid)
   if(!$CandidateAgain -or $CandidateAgain.CreationDate -ne $CandidateHost.CreationDate -or $CandidateAgain.ExecutablePath -ne $CandidateExe){throw 'Owned process identity changed'}
   [XjyReadOwnedWindow]::Confirm([uint32]$CandidateHostPid,[long]$OwnedNativeDialogs[0].hwnd,[long]$CandidateNativeButtons[0].hwnd,[long]$OwnedNativeDialogs[0].owner,$CandidateTitle,$CandidateButton)
   $CandidateClicked=$true
   break
  }
 }
 Start-Sleep -Milliseconds 150
}
if(!$CandidateClicked){
 $ObservedWindows=@()
 $TopWindows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
 foreach($Element in $TopWindows){
  if($Element.Current.ProcessId -ne $CandidateHostPid){continue}
  $Info=[ordered]@{name=$Element.Current.Name;type=$Element.Current.ControlType.ProgrammaticName;className=$Element.Current.ClassName;offscreen=$Element.Current.IsOffscreen;children=@()}
  $Children=$Element.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  for($Index=0;$Index -lt [Math]::Min(200,$Children.Count);$Index++){$Child=$Children[$Index];$Info.children+=@([pscustomobject]@{name=$Child.Current.Name;type=$Child.Current.ControlType.ProgrammaticName;className=$Child.Current.ClassName;pid=$Child.Current.ProcessId;enabled=$Child.Current.IsEnabled;offscreen=$Child.Current.IsOffscreen})}
  $ObservedWindows+=@([pscustomobject]$Info)
 }
 $Observation=[ordered]@{clicked=0;hostPid=$CandidateHostPid;hostSession=$CandidateHost.SessionId;runnerSession=$CandidateRunner.SessionId;titleExpected=$CandidateTitle;messageExpected=$CandidateMessage;buttonExpected=$CandidateButton;windows=$ObservedWindows;direct=$CandidateDirectObservation;win32=@([XjyReadOwnedWindow]::Run([uint32]$CandidateHostPid))}
 [IO.File]::WriteAllText((Join-Path $CandidateRoot 'reports\candidate-three-database-attachments-restore\native-window-observation.json'),($Observation|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
 throw 'Exact real restore dialog/button was not observed; no click performed'
}
[pscustomobject]@{actualGuest=$true;hostPid=$CandidateHostPid;clicked=1;titleMatched=$true;messageMatched=$true;buttonMatched=$true;processIdentityStable=$true;discovery='exact owned Win32 dialog/button and UIA body text';nativeButtonClass='Button';nativeClickMessages=1;actualCreationDate=$CandidateHost.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress
