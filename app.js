import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc, updateDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const HOUSEHOLD = "financinho-casal";
const $ = (id) => document.getElementById(id);
const brl = (v) => Number(v || 0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const today = () => new Date().toISOString().slice(0,10);
const currentMonth = () => today().slice(0,7);
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const categories = ["Moradia","Alimentação","Transporte","Saúde","Pets","Lazer","Compras pessoais","Estudos","Salário","Renda extra","Contas e serviços","Dívidas","Reserva financeira","Investimentos","Outros"];
const types = {
  transaction:{title:"Novo lançamento",fields:[
    ["description","Descrição","text",true],["type","Tipo","select",true,["income:Entrada","expense:Saída"]],
    ["amount","Valor (R$)","number",true],["date","Data","date",true],["category","Categoria","select",true,categories.map(x=>x+":"+x)],
    ["person","Quem registrou","select",true,["Pessoa 1:Pessoa 1","Pessoa 2:Pessoa 2","Ambos:Ambos"]],
    ["paymentMethod","Forma de pagamento","select",false,["Pix:Pix","Dinheiro:Dinheiro","Débito:Débito","Crédito:Crédito","Boleto:Boleto","Transferência:Transferência","Outro:Outro"]],
    ["notes","Observações","textarea",false]
  ]},
  bill:{title:"Nova conta a pagar",fields:[["description","Nome da conta","text",true],["amount","Valor (R$)","number",true],["dueDate","Vencimento","date",true],["category","Categoria","select",true,categories.map(x=>x+":"+x)],["recurrence","Recorrência","select",false,["Única:Única","Mensal:Mensal","Anual:Anual"]],["notes","Observações","textarea",false]]},
  debt:{title:"Nova dívida",fields:[["description","Dívida / credor","text",true],["total","Valor total (R$)","number",true],["remaining","Saldo restante (R$)","number",true],["installmentAmount","Valor da parcela (R$)","number",false],["dueDate","Próximo vencimento","date",false],["interest","Juros ao mês (%)","number",false],["priority","Prioridade","select",true,["Alta:Alta","Média:Média","Baixa:Baixa"]],["notes","Plano de pagamento / observações","textarea",false]]},
  card:{title:"Cadastrar cartão",fields:[["description","Nome do cartão","text",true],["limit","Limite (R$)","number",false],["closingDay","Dia de fechamento","number",false],["dueDay","Dia de vencimento","number",false],["holder","Titular","select",true,["Pessoa 1:Pessoa 1","Pessoa 2:Pessoa 2","Compartilhado:Compartilhado"]]]},
  installment:{title:"Planejar compra parcelada",fields:[["description","Nome da compra","text",true],["total","Valor total (R$)","number",true],["count","Número de parcelas","number",true],["firstDueDate","Vencimento da 1ª parcela","date",true],["cardName","Cartão usado","text",false],["category","Categoria","select",true,categories.map(x=>x+":"+x)],["notes","Observações","textarea",false]]},
  budget:{title:"Definir orçamento mensal",fields:[["category","Categoria","select",true,categories.map(x=>x+":"+x)],["limit","Limite mensal (R$)","number",true],["month","Mês do orçamento","month",true]]},
  goal:{title:"Criar meta ou cofrinho",fields:[["description","Nome da meta","text",true],["target","Valor desejado (R$)","number",true],["saved","Quanto já guardaram (R$)","number",true],["deadline","Prazo (opcional)","date",false],["notes","Por que essa meta importa?","textarea",false]]},
  asset:{title:"Adicionar patrimônio / investimento",fields:[["description","Nome do item","text",true],["kind","Tipo","select",true,["Conta bancária:Conta bancária","Dinheiro guardado:Dinheiro guardado","Investimento:Investimento","Imóvel:Imóvel","Veículo:Veículo","Outro bem:Outro bem"]],["value","Valor atual (R$)","number",true],["owner","Titular","select",true,["Pessoa 1:Pessoa 1","Pessoa 2:Pessoa 2","Compartilhado:Compartilhado"]],["notes","Observações","textarea",false]]}
};
let records = [], editing = null, flowChart, categoryChart, reportChart, toastTimer;

function path() { return collection(db,"households",HOUSEHOLD,"records"); }
function toast(message) { const t=$("toast"); t.textContent=message; t.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("show"),2600); }
function message(el, text, ok=false) { el.textContent=text; el.style.color=ok?"#25805b":"#bd5151"; }
function moneyField(value){ return Number(value||0); }
function monthRecords(){ const m=$("month-filter").value||currentMonth(); return records.filter(r=>(r.date||r.dueDate||r.firstDueDate||r.createdAtDate||"").startsWith(m)); }
function sum(arr, field){return arr.reduce((s,r)=>s+moneyField(r[field]),0)}
function saveButtonDisabled(btn, disabled){btn.disabled=disabled;btn.style.opacity=disabled?".65":"1"}

$("month-filter").value=currentMonth();
$("today-label").textContent = new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"}).toUpperCase();

$("auth-form").addEventListener("submit", async e=>{
  e.preventDefault(); const btn=$("login-btn"); saveButtonDisabled(btn,true); message($("auth-message"),"Entrando...");
  try { await signInWithEmailAndPassword(auth,$("email").value.trim(),$("password").value); }
  catch(err){ message($("auth-message"),authError(err)); }
  finally{saveButtonDisabled(btn,false);}
});
$("signup-btn").addEventListener("click",async()=>{
  message($("auth-message"),"Criando conta...");
  try { await createUserWithEmailAndPassword(auth,$("email").value.trim(),$("password").value); message($("auth-message"),"Conta criada. Se o acesso aos dados for negado, siga o passo de segurança no guia.",true); }
  catch(err){message($("auth-message"),authError(err));}
});
function authError(err){
  const code=err?.code||"";
  const messages={"auth/invalid-email":"Confira o formato do e-mail.","auth/invalid-credential":"E-mail ou senha incorretos.","auth/email-already-in-use":"Este e-mail já tem uma conta. Entre em vez de criar outra.","auth/weak-password":"Use uma senha com pelo menos 6 caracteres.","auth/operation-not-allowed":"Ative o método E-mail/senha no Firebase Authentication.","auth/network-request-failed":"Falha de conexão. Confira sua internet."};
  return messages[code]||`Não foi possível concluir. Código: ${code||"erro"}. Confira a configuração do Firebase.`;
}
onAuthStateChanged(auth,async user=>{
  $("auth-screen").classList.toggle("hidden",!!user); $("app").classList.toggle("hidden",!user);
  if(user){$("user-email").textContent=user.email||"Conta"; await loadRecords();}
});
$("logout-btn").addEventListener("click",()=>signOut(auth));
async function loadRecords(){
  try {
    const snap=await getDocs(query(path(),orderBy("createdAt","desc")));
    records=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderAll();
  } catch(err) {
    records=[];
    renderAll();
    toast(err.code==="permission-denied"?"Acesso ainda não liberado: siga o guia para cadastrar os UIDs nas regras do Firestore.":"Não consegui carregar os dados. Confira Firebase e conexão.");
    console.error(err);
  }
}
async function createRecord(data){
  await addDoc(path(),{...data,createdAt:serverTimestamp(),createdAtDate:today(),createdBy:auth.currentUser?.uid||""});
  await loadRecords(); toast("Registro salvo!");
}
async function patchRecord(id,data){ await updateDoc(doc(db,"households",HOUSEHOLD,"records",id),data); await loadRecords(); toast("Registro atualizado!"); }
async function removeRecord(id){
  if(!confirm("Tem certeza de que deseja excluir este registro?")) return;
  try{await deleteDoc(doc(db,"households",HOUSEHOLD,"records",id));await loadRecords();toast("Registro excluído.");}
  catch(e){toast("Não foi possível excluir o registro.");}
}

$("nav").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)showPage(b.dataset.page);});
document.addEventListener("click",e=>{
  const p=e.target.closest("[data-page]"); if(p){showPage(p.dataset.page);return;}
  const f=e.target.closest("[data-open-form]"); if(f)openForm(f.dataset.openForm);
});
function showPage(page){
  document.querySelectorAll(".page").forEach(el=>el.classList.add("hidden"));
  $(`${page}-page`)?.classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(el=>el.classList.toggle("active",el.dataset.page===page));
  const active=document.querySelector(`.nav-link[data-page="${page}"] span`);
  $("page-title").textContent=active?.textContent||({dashboard:"Visão geral",transactions:"Entradas e saídas",bills:"Contas a pagar",debts:"Dívidas",cards:"Cartões e parcelas",budgets:"Orçamento por setor",goals:"Metas e reservas",assets:"Patrimônio",reports:"Relatórios"}[page]||"Financinho");
  if(page==="reports")renderReports();
}
$("quick-add").addEventListener("click",()=>openForm("transaction"));
$("month-filter").addEventListener("change",renderAll);
$("transaction-search").addEventListener("input",renderTransactions);
$("transaction-type-filter").addEventListener("change",renderTransactions);
$("transaction-category-filter").addEventListener("change",renderTransactions);
$("close-modal").addEventListener("click",closeForm); $("cancel-modal").addEventListener("click",closeForm);
function closeForm(){$("record-dialog").close();editing=null;}
function openForm(kind,record=null){
  editing=record?{kind,id:record.id}:null;
  const def=types[kind]; if(!def)return;
  $("modal-title").textContent=record?`Editar: ${def.title.replace("Novo ","")}`:def.title;
  $("form-fields").innerHTML=def.fields.map(([name,label,type,required,options])=>{
    const value=record?.[name]??(name==="date"||name==="dueDate"||name==="firstDueDate"?today():name==="month"?currentMonth():name==="type"?"expense":name==="person"?"Pessoa 1":name==="priority"?"Média":name==="saved"||name==="remaining"?"0":"");
    let control="";
    if(type==="select")control=`<select name="${name}" ${required?"required":""}>${(options||[]).map(opt=>{const [val,text]=opt.includes(":")?opt.split(":"):[opt,opt];return `<option value="${escapeHTML(val)}" ${String(value)===val?"selected":""}>${escapeHTML(text)}</option>`}).join("")}</select>`;
    else if(type==="textarea")control=`<textarea name="${name}" rows="3">${escapeHTML(value)}</textarea>`;
    else control=`<input name="${name}" type="${type}" value="${escapeHTML(value)}" ${required?"required":""} ${type==="number"?'min="0" step="0.01"':""}>`;
    return `<div class="field ${type==="textarea"?"full-span":""}"><label>${escapeHTML(label)}${required?" *":""}</label>${control}</div>`;
  }).join("");
  $("form-message").textContent="";
  $("record-dialog").showModal();
}
$("record-form").addEventListener("submit",async e=>{
  e.preventDefault(); const form=e.currentTarget; const submit=form.querySelector('[type="submit"]'); saveButtonDisabled(submit,true);
  const data=Object.fromEntries(new FormData(form).entries());
  for(const [k,v] of Object.entries(data)){ if(["amount","total","remaining","installmentAmount","interest","limit","closingDay","dueDay","count","target","saved","value"].includes(k))data[k]=v===""?0:Number(v); }
  const kind=editing?.kind || inferKindFromTitle($("modal-title").textContent);
  // Infer the form type from the field set so edit and create share the same validation path.
  const activeKind=editing?.kind || currentFormKind;
  try {
    if(activeKind==="transaction") data.amount=Math.abs(Number(data.amount||0));
    if(activeKind==="bill") data.paid=false;
    if(activeKind==="debt" && data.remaining===undefined)data.remaining=data.total;
    if(editing) await patchRecord(editing.id,data); else await createRecord({...data,kind:activeKind});
    closeForm();
  } catch(err){message($("form-message"),"Não foi possível salvar. Confira se as regras do Firestore foram configuradas.");console.error(err);}
  finally{saveButtonDisabled(submit,false);}
});
let currentFormKind="transaction";
const originalOpenForm=openForm;
openForm=function(kind,record=null){currentFormKind=kind;return originalOpenForm(kind,record);};
function inferKindFromTitle(){return currentFormKind;}

function empty(text,detail="Adicionem o primeiro registro para começar."){return `<div class="empty-state"><b>${escapeHTML(text)}</b>${escapeHTML(detail)}</div>`}
function recordCard(r,icon,detail,amount,actions=""){
 return `<article class="record"><div class="record-icon">${icon}</div><div class="record-main"><h4>${escapeHTML(r.description||"Sem nome")}</h4><p>${escapeHTML(detail||"")}</p></div><div class="record-side"><strong>${escapeHTML(amount||"")}</strong>${r.date?`<small>${new Date(r.date+"T12:00:00").toLocaleDateString("pt-BR")}</small>`:""}</div><div class="record-actions">${actions}</div></article>`;
}
function actionButtons(r,kind,extra=""){return `${extra}<button class="small-btn" data-edit="${r.id}" data-kind="${kind}">Editar</button><button class="small-btn" data-delete="${r.id}">Excluir</button>`}
document.addEventListener("click",async e=>{
 const del=e.target.closest("[data-delete]");if(del){await removeRecord(del.dataset.delete);return;}
 const edit=e.target.closest("[data-edit]");if(edit){const r=records.find(x=>x.id===edit.dataset.edit);if(r)openForm(edit.dataset.kind,r);return;}
 const paid=e.target.closest("[data-paid]");if(paid){const r=records.find(x=>x.id===paid.dataset.paid);if(r)await patchRecord(r.id,{paid:!r.paid});return;}
 const addGoal=e.target.closest("[data-add-saved]");if(addGoal){const r=records.find(x=>x.id===addGoal.dataset.addSaved);const amount=prompt("Quanto vocês querem adicionar ao valor guardado? (R$)","0");if(amount!==null&&Number(amount)>=0)await patchRecord(r.id,{saved:Number(r.saved||0)+Number(amount)});return;}
 const payDebt=e.target.closest("[data-pay-debt]");if(payDebt){const r=records.find(x=>x.id===payDebt.dataset.payDebt);const amount=prompt("Valor pago agora (R$)","0");if(amount!==null&&Number(amount)>=0)await patchRecord(r.id,{remaining:Math.max(0,Number(r.remaining||0)-Number(amount))});return;}
});

function renderAll(){renderDashboard();renderTransactions();renderBills();renderDebts();renderCards();renderBudgets();renderGoals();renderAssets();renderReports();refreshCategoryFilter();}
function refreshCategoryFilter(){const s=$("transaction-category-filter"),old=s.value;const opts=[...new Set(records.filter(r=>r.kind==="transaction").map(r=>r.category).filter(Boolean))];s.innerHTML='<option value="all">Todas as categorias</option>'+opts.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");if(opts.includes(old))s.value=old;}
function renderDashboard(){
 const m=$("month-filter").value||currentMonth(), tx=records.filter(r=>r.kind==="transaction"&&(r.date||"").startsWith(m));
 const inc=sum(tx.filter(r=>r.type==="income"),"amount"),out=sum(tx.filter(r=>r.type==="expense"),"amount");
 $("metric-income").textContent=brl(inc);$("metric-expense").textContent=brl(out);$("metric-balance").textContent=brl(inc-out);
 $("metric-debts").textContent=brl(sum(records.filter(r=>r.kind==="debt"),"remaining"));
 const days=Array.from({length:31},(_,i)=>String(i+1));const incomes=days.map((_,i)=>sum(tx.filter(r=>r.type==="income"&&Number((r.date||"").slice(8,10))===i+1),"amount"));const expenses=days.map((_,i)=>sum(tx.filter(r=>r.type==="expense"&&Number((r.date||"").slice(8,10))===i+1),"amount"));
 if(flowChart)flowChart.destroy();flowChart=new Chart($("flow-chart"),{type:"line",data:{labels:days, datasets:[{label:"Entradas",data:incomes,borderColor:"#2c8b65",backgroundColor:"#2c8b6518",fill:true,tension:.3},{label:"Saídas",data:expenses,borderColor:"#c16a64",backgroundColor:"#c16a6418",fill:true,tension:.3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{usePointStyle:true,boxWidth:7,font:{size:10}}}},scales:{x:{ticks:{maxTicksLimit:8,font:{size:9}},grid:{display:false}},y:{ticks:{font:{size:9}},grid:{color:"#eef0f4"}}}}});
 const cats=Object.entries(tx.filter(r=>r.type==="expense").reduce((a,r)=>(a[r.category||"Outros"]=(a[r.category||"Outros"]||0)+Number(r.amount||0),a),{}));
 $("category-empty").classList.toggle("hidden",cats.length>0);
 if(categoryChart)categoryChart.destroy();categoryChart=new Chart($("category-chart"),{type:"doughnut",data:{labels:cats.map(x=>x[0]),datasets:[{data:cats.map(x=>x[1]),backgroundColor:["#c9a45e","#243b59","#568b80","#bb7d72","#9b8bb4","#d9c5a0","#7293b5","#7d8c9c"]}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{boxWidth:8,usePointStyle:true,font:{size:9}}}}}});
 const bills=records.filter(r=>r.kind==="bill"&&!r.paid).sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||"")).slice(0,4);
 $("upcoming-list").innerHTML=bills.length?bills.map(r=>`<div class="mini-row"><div><b>${escapeHTML(r.description)}</b><small>Vence ${r.dueDate?new Date(r.dueDate+"T12:00:00").toLocaleDateString("pt-BR"):"sem data"}</small></div><strong>${brl(r.amount)}</strong></div>`).join(""):empty("Nenhuma conta pendente","Cadastrem as contas para acompanhar os vencimentos.");
 const goals=records.filter(r=>r.kind==="goal").slice(0,3);
 $("dashboard-goals").innerHTML=goals.length?goals.map(r=>`<div class="mini-row"><div><b>${escapeHTML(r.description)}</b><small>${Math.min(100,Math.round(Number(r.saved||0)/Math.max(1,Number(r.target||0))*100))}% da meta</small></div><strong>${brl(r.saved)} / ${brl(r.target)}</strong></div>`).join(""):empty("Nenhuma meta cadastrada","Criem um cofrinho para um objetivo de vocês.");
}
function renderTransactions(){
 const m=$("month-filter").value||currentMonth(), search=($("transaction-search").value||"").toLowerCase(), type=$("transaction-type-filter").value, cat=$("transaction-category-filter").value;
 const list=records.filter(r=>r.kind==="transaction"&&(r.date||"").startsWith(m)&&(`${r.description} ${r.category} ${r.notes}`.toLowerCase().includes(search))&&(type==="all"||r.type===type)&&(cat==="all"||r.category===cat)).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
 $("transactions-list").innerHTML=list.length?list.map(r=>recordCard(r,r.type==="income"?"↗":"↘",`${r.category||"Sem categoria"} · ${r.person||"Responsável não informado"} · ${r.paymentMethod||"Forma não informada"}`,`${r.type==="income"?"+":"−"} ${brl(r.amount)}`,actionButtons(r,"transaction"))).join(""):empty("Nenhum lançamento encontrado","Adicionem uma entrada ou saída para começar.");
}
function renderBills(){
 const list=records.filter(r=>r.kind==="bill").sort((a,b)=>(a.dueDate||"").localeCompare(b.dueDate||""));
 $("bills-list").innerHTML=list.length?list.map(r=>recordCard(r,"▤",`${r.category||"Conta"} · Vence ${r.dueDate?new Date(r.dueDate+"T12:00:00").toLocaleDateString("pt-BR"):"sem data"} · ${r.recurrence||"Única"}`,brl(r.amount),actionButtons(r,"bill",`<button class="small-btn ${r.paid?"done":""}" data-paid="${r.id}">${r.paid?"Paga":"Marcar paga"}</button>`))).join(""):empty("Nenhuma conta cadastrada","Adicionem aluguel, água, energia, internet e outros vencimentos.");
}
function renderDebts(){
 const list=records.filter(r=>r.kind==="debt");
 $("debts-list").innerHTML=list.length?list.map(r=>recordCard(r,"◎",`${r.priority||"Prioridade não definida"} · Total original ${brl(r.total)} · Parcela ${brl(r.installmentAmount)}${r.dueDate?" · Próximo vencimento "+new Date(r.dueDate+"T12:00:00").toLocaleDateString("pt-BR"):""}`,`Restam ${brl(r.remaining)}`,actionButtons(r,"debt",`<button class="small-btn" data-pay-debt="${r.id}">Registrar pagamento</button>`))).join(""):empty("Nenhuma dívida cadastrada","Registrem o saldo restante e a estratégia de quitação.");
}
function renderCards(){
 const cards=records.filter(r=>r.kind==="card"), ins=records.filter(r=>r.kind==="installment");
 $("cards-list").innerHTML=cards.length?cards.map(r=>recordCard(r,"▣",`${r.holder||"Titular não informado"} · Fecha dia ${r.closingDay||"—"} · Vence dia ${r.dueDay||"—"}`,`Limite ${brl(r.limit)}`,actionButtons(r,"card"))).join(""):empty("Nenhum cartão cadastrado","Cadastrem os cartões de vocês.");
 $("installments-list").innerHTML=ins.length?ins.map(r=>recordCard(r,"▤",`${r.count||0} parcelas de ${brl(Number(r.total||0)/Math.max(1,Number(r.count||1)))} · 1º vencimento ${r.firstDueDate?new Date(r.firstDueDate+"T12:00:00").toLocaleDateString("pt-BR"):"—"} · ${r.cardName||"Cartão não informado"}`,brl(r.total),actionButtons(r,"installment"))).join(""):empty("Nenhuma compra parcelada","Planejem compras antes de assumir novas parcelas.");
}
function renderBudgets(){
 const list=records.filter(r=>r.kind==="budget"&&(r.month||currentMonth())===( $("month-filter").value||currentMonth()));
 $("budgets-list").innerHTML=list.length?list.map(r=>{const spent=sum(records.filter(t=>t.kind==="transaction"&&t.type==="expense"&&t.category===r.category&&(t.date||"").startsWith(r.month||currentMonth())),"amount");const pct=Math.min(100,Math.round(spent/Math.max(1,r.limit)*100));return `<article class="budget-card"><h4>${escapeHTML(r.category)}</h4><p>Limite mensal: ${brl(r.limit)}</p><div class="progress-line"><span style="width:${pct}%;background:${spent>r.limit?"#bd5151":"#c9a45e"}"></span></div><div class="progress-meta"><span>${brl(spent)} utilizados</span><b>${pct}%</b></div><div class="record-actions" style="margin-top:13px">${actionButtons(r,"budget")}</div></article>`}).join(""):empty("Nenhum orçamento definido","Escolham um limite para cada setor do mês.");
}
function renderGoals(){
 const list=records.filter(r=>r.kind==="goal");
 $("goals-list").innerHTML=list.length?list.map(r=>{const pct=Math.min(100,Math.round(Number(r.saved||0)/Math.max(1,Number(r.target||0))*100));return `<article class="goal-card"><h4>☆ ${escapeHTML(r.description)}</h4><p>${escapeHTML(r.notes||"Meta financeira compartilhada")}${r.deadline?" · Prazo "+new Date(r.deadline+"T12:00:00").toLocaleDateString("pt-BR"):""}</p><div class="goal-value">${brl(r.saved)}</div><div class="progress-line"><span style="width:${pct}%"></span></div><div class="progress-meta"><span>Objetivo: ${brl(r.target)}</span><b>${pct}%</b></div><div class="record-actions" style="margin-top:14px"><button class="small-btn done" data-add-saved="${r.id}">＋ Guardar valor</button>${actionButtons(r,"goal")}</div></article>`}).join(""):empty("Nenhuma meta criada","Criem metas como reserva de emergência, viagem ou casa.");
}
function renderAssets(){
 const list=records.filter(r=>r.kind==="asset"), assets=sum(list,"value"), debts=sum(records.filter(r=>r.kind==="debt"),"remaining");
 $("assets-total").textContent=brl(assets);$("assets-debts").textContent=brl(debts);$("net-worth").textContent=brl(assets-debts);
 $("assets-list").innerHTML=list.length?list.map(r=>recordCard(r,"◇",`${r.kind==="asset"?r.kind:"Patrimônio"} · ${r.owner||"Titular não informado"} · ${r.notes||""}`,brl(r.value),actionButtons(r,"asset"))).join(""):empty("Nenhum patrimônio cadastrado","Adicionem saldos de contas, investimentos e bens.");
}
function renderReports(){
 const m=$("month-filter").value||currentMonth(),tx=records.filter(r=>r.kind==="transaction"&&(r.date||"").startsWith(m));
 const inc=sum(tx.filter(r=>r.type==="income"),"amount"),out=sum(tx.filter(r=>r.type==="expense"),"amount");
 $("report-income").textContent=brl(inc);$("report-expense").textContent=brl(out);$("report-net").textContent=brl(inc-out);
 const cats=Object.entries(tx.filter(r=>r.type==="expense").reduce((a,r)=>(a[r.category||"Outros"]=(a[r.category||"Outros"]||0)+Number(r.amount||0),a),{}));
 if(reportChart)reportChart.destroy();reportChart=new Chart($("report-chart"),{type:"bar",data:{labels:cats.map(x=>x[0]),datasets:[{label:"Gastos (R$)",data:cats.map(x=>x[1]),backgroundColor:"#c9a45e",borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10}},grid:{display:false}},y:{beginAtZero:true,ticks:{font:{size:10}}}}}});
}
$("export-btn").addEventListener("click",()=>{
 const rows=[["tipo","descrição","categoria","valor","data","responsável","observações"],...records.map(r=>[r.kind||"",r.description||"",r.category||"",r.amount??r.total??r.value??"",r.date||r.dueDate||r.firstDueDate||"",r.person||r.owner||"",r.notes||""])];
 const csv=rows.map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\r\n");
 const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`financinho-${currentMonth()}.csv`;a.click();URL.revokeObjectURL(url);
});
