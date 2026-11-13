import {
  addDoc,
  collection,
  db,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "./firebase.js?v=20260803-stock-2";
import { deleteImage, uploadImage } from "./image-storage.js";

const ADMIN_ACCESS_CODE = "1001";
const adminGate = document.querySelector("#adminGate");
const adminGateForm = document.querySelector("#adminGateForm");
const adminAccessCode = document.querySelector("#adminAccessCode");
const adminGateError = document.querySelector("#adminGateError");

function unlockAdmin() {
  sessionStorage.setItem("horizon-admin-unlocked", "1");
  document.body.classList.remove("admin-locked");
  adminGate.hidden = true;
}

if (sessionStorage.getItem("horizon-admin-unlocked") === "1") unlockAdmin();

adminGateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (adminAccessCode.value === ADMIN_ACCESS_CODE) {
    unlockAdmin();
    return;
  }
  adminGateError.textContent = "رمز الدخول غير صحيح";
  adminAccessCode.value = "";
  adminAccessCode.focus();
});

adminAccessCode.addEventListener("input", () => {
  adminAccessCode.value = adminAccessCode.value.replace(/\D/g, "").slice(0, 4);
  adminGateError.textContent = "";
});

const $ = (selector) => document.querySelector(selector);
const tabs = [...document.querySelectorAll("[data-tab]")];
const pages = [...document.querySelectorAll("[data-page]")];
let categories = [];
let products = [];
let orders = [];
let productSearchTerm = "";
let editingCategoryId = null;
let editingProductId = null;
let deletingProductId = null;
let deletingCategoryId = null;
let deleteConfirmationStep = 1;
let productVariantsDraft = [];
const DEFAULT_MATERIAL_TYPES = [
  "PLA", "PLA+", "PETG", "ABS", "ASA", "TPU", "Like Marble", "Resin",
  "Water Wash Resin", "Standard Resin", "ABS Resin", "Tough Resin", "16K Resin",
];
const customMaterialTypes = new Set();

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const money = (value) => `${new Intl.NumberFormat("ar-IQ").format(Number(value) || 0)} د.ع`;

function showToast(message) {
  const toast = $("#adminToast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function activatePage(pageName) {
  tabs.forEach((item) => item.classList.toggle("active", item.dataset.tab === pageName));
  pages.forEach((page) => page.classList.toggle("active", page.dataset.page === pageName));
}

tabs.forEach((tab) => tab.addEventListener("click", () => activatePage(tab.dataset.tab)));

const categoryFormCard = $("#categoryFormCard");
const categoryForm = $("#categoryForm");
const categoryImageInput = $("#categoryImage");
const categoryImagePreview = $("#categoryImagePreview");
const categoryUploadArea = $("#imageUploadArea");

function setCategoryFormOpen(isOpen) {
  categoryFormCard.classList.toggle("open", isOpen);
  categoryFormCard.setAttribute("aria-hidden", String(!isOpen));
  $("#addCategoryButton").setAttribute("aria-expanded", String(isOpen));
  if (isOpen) window.setTimeout(() => $("#categoryName")?.focus(), 180);
}

function resetCategoryForm() {
  categoryForm.reset();
  editingCategoryId = null;
  categoryImageInput.setAttribute("required", "");
  categoryImagePreview.removeAttribute("src");
  categoryUploadArea.classList.remove("has-image");
  categoryFormCard.querySelector("h2").textContent = "قسم جديد";
  categoryForm.querySelector(".save-category-button span").textContent = "حفظ القسم";
}

function renderCategories() {
  $("#emptyCategories").hidden = categories.length > 0;
  $("#savedCategories").innerHTML = categories.map((category) => `
    <article class="category-card" data-category-id="${category.docId}">
      <img class="category-card-image" src="${category.image}" alt="${escapeHtml(category.name)}">
      <div class="category-card-body"><h3>${escapeHtml(category.name)}</h3><div class="category-card-actions">
        <button class="edit-category-button" type="button" data-action="edit" aria-label="تعديل ${escapeHtml(category.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19 9l-4-4L4 16Zm9-9 4 4"/></svg><span>تعديل</span></button>
        <button class="delete-category-button" type="button" data-action="delete" aria-label="حذف ${escapeHtml(category.name)}">×</button>
      </div></div>
    </article>`).join("");
  $("#productCategory").innerHTML = '<option value="" selected disabled>اختر القسم</option>' + categories
    .map((category) => `<option value="${category.docId}">${escapeHtml(category.name)}</option>`).join("");
}

function renderProducts() {
  const normalizedSearch = productSearchTerm.trim().toLocaleLowerCase("ar").normalize("NFKC");
  const visibleProducts = normalizedSearch
    ? products.filter((product) => String(product.name || "").trim().toLocaleLowerCase("ar").normalize("NFKC").startsWith(normalizedSearch))
    : products;
  $("#emptyProducts").hidden = products.length > 0;
  $("#productSearchBar").hidden = products.length === 0;
  $("#productSearchEmpty").hidden = products.length === 0 || visibleProducts.length > 0;
  $("#clearProductSearch").hidden = !productSearchTerm;
  $("#productSearchCount").textContent = productSearchTerm ? `${visibleProducts.length} نتيجة` : `${products.length} منتج`;
  $("#savedProducts").innerHTML = visibleProducts.map((product) => {
    const stock = normalizeStock(product.stock);
    const pricing = productPricing(product);
    const variants = normalizeVariants(product);
    return `
    <article class="category-card product-admin-card ${stock === 0 ? "out-of-stock" : ""}" data-product-id="${product.docId}">
      <img class="category-card-image" src="${product.image || ""}" alt="${escapeHtml(product.name)}">
      <div class="category-card-body"><h3>${escapeHtml(product.name)}</h3>
        <div class="admin-product-meta"><span class="admin-stock ${stock === 0 ? "empty" : ""}">${stock === 0 ? "نافذ" : `المخزن: ${stock}`}</span>${variants.length ? `<span class="admin-variants-count">${variants.length} ألوان</span>` : ""}${pricing.discount ? `<span class="admin-discount">خصم ${money(pricing.discount)}</span>` : ""}</div>
        <p>${escapeHtml(product.categoryLabel)}${product.materialType ? ` · ${escapeHtml(product.materialType)}` : ""} · ${money(pricing.current)}${pricing.before ? ` <del>${money(pricing.before)}</del>` : ""}</p>
        <div class="category-card-actions"><button class="edit-category-button" type="button" data-edit-product aria-label="تعديل ${escapeHtml(product.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19 9l-4-4L4 16Zm9-9 4 4"/></svg><span>تعديل</span></button><button class="delete-category-button" type="button" data-delete-product aria-label="حذف ${escapeHtml(product.name)}">×</button></div>
      </div>
    </article>`;
  }).join("");
}

$("#productSearchInput").addEventListener("input", (event) => {
  productSearchTerm = event.target.value;
  renderProducts();
});

$("#clearProductSearch").addEventListener("click", () => {
  productSearchTerm = "";
  $("#productSearchInput").value = "";
  renderProducts();
  $("#productSearchInput").focus();
});

function normalizeStock(value) {
  const stock = Number(value);
  return Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 0;
}

function normalizeVariants(product) {
  return (Array.isArray(product?.variants) ? product.variants : [])
    .map((variant, index) => ({
      id: String(variant?.id || `variant-${index + 1}`),
      name: String(variant?.name || "").trim(),
      color: /^#[0-9a-f]{6}$/i.test(String(variant?.color || "")) ? String(variant.color) : "#111111",
      image: String(variant?.image || ""),
      imagePath: String(variant?.imagePath || ""),
      stock: normalizeStock(variant?.stock),
    }))
    .filter((variant) => variant.name && variant.image);
}

function productPricing(product) {
  const price = Math.max(0, Number(product?.price) || 0);
  const oldPrice = Math.max(0, Number(product?.oldPrice) || 0);
  if (oldPrice > price) return { current: price, before: oldPrice, discount: oldPrice - price };
  const legacyDiscount = Number(product?.discount) || 0;
  if (legacyDiscount > 0 && legacyDiscount < price) {
    return { current: price - legacyDiscount, before: price, discount: legacyDiscount };
  }
  return { current: price, before: 0, discount: 0 };
}

function orderCard(order, completed) {
  const items = Array.isArray(order.items) ? order.items : [];
  const createdAt = formatOrderDate(order.createdAt || order.createdAtClient);
  const completedAt = completed ? formatOrderDate(order.completedAt) : "";
  const subtotal = Number(order.subtotal) || items.reduce((sum, item) => sum + ((Number(item.lineTotal) || (Number(item.price) || 0) * (Number(item.quantity) || 0))), 0);
  const deliveryCost = Number(order.deliveryCost) || 0;
  return `<article class="order-card" data-order-id="${order.docId}">
    <div class="order-card-head">
      <div><span class="order-status ${completed ? "completed" : "pending"}">${completed ? "مكتمل" : "طلب جديد"}</span><small>${escapeHtml(order.reference || order.docId)}</small><h3>${escapeHtml(order.customer?.name || "زبون بدون اسم")}</h3></div>
      <div class="order-head-total"><small>المجموع الكلي</small><b>${money(Number(order.total) || subtotal + deliveryCost)}</b></div>
    </div>
    <div class="order-date-row"><span>تاريخ الطلب</span><b>${escapeHtml(createdAt)}</b>${completedAt ? `<span>تاريخ الإكمال</span><b>${escapeHtml(completedAt)}</b>` : ""}</div>
    <div class="customer-fields">
      <div><small>رقم الهاتف</small><a href="tel:${escapeHtml(order.customer?.phone || "")}">${escapeHtml(order.customer?.phone || "غير متوفر")}</a></div>
      <div><small>المحافظة</small><b>${escapeHtml(order.customer?.governorate || "غير محددة")}</b></div>
      <div class="wide"><small>العنوان</small><b>${escapeHtml(order.customer?.address || "غير متوفر")}</b></div>
    </div>
    <div class="order-items">
      ${items.map((item) => orderItemCard(item)).join("") || '<p class="order-no-items">لا توجد تفاصيل منتجات محفوظة لهذا الطلب.</p>'}
    </div>
    <div class="order-totals">
      <span>مجموع المنتجات <b>${money(subtotal)}</b></span>
      <span>التوصيل <b>${money(deliveryCost)}</b></span>
      <span class="grand-total">الإجمالي <b>${money(Number(order.total) || subtotal + deliveryCost)}</b></span>
    </div>
    <div class="order-actions">
      ${completed ? "" : '<button class="complete-order-button" type="button">✓ موافقة الطلب وخصم المخزون</button>'}
      <button class="delete-order-button" type="button">حذف الطلب</button>
    </div>
  </article>`;
}

function orderItemCard(item) {
  const currentProduct = products.find((product) => Number(product.id) === Number(item.id));
  const image = item.image || currentProduct?.image || "";
  const price = Number(item.price) || Number(currentProduct?.price) || 0;
  const quantity = Number(item.quantity) || 0;
  const lineTotal = Number(item.lineTotal) || price * quantity;
  const variantLabel = item.variantName ? `<span class="order-variant"><i style="--variant-color:${escapeHtml(item.variantColor || "#111111")}"></i>${escapeHtml(item.variantName)}</span>` : "";
  return `<article class="order-item">
    ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name || currentProduct?.name || "منتج")}">` : '<div class="order-item-placeholder">◇</div>'}
    <div><small>${escapeHtml(item.categoryLabel || currentProduct?.categoryLabel || "منتج")}</small><h4>${escapeHtml(item.name || currentProduct?.name || "منتج محذوف")}</h4>${variantLabel}<p>${quantity} × ${money(price)}</p></div>
    <b>${money(lineTotal)}</b>
  </article>`;
}

function orderTimeValue(value) {
  if (value?.toDate) return value.toDate().getTime();
  if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatOrderDate(value) {
  const timestamp = orderTimeValue(value);
  if (!timestamp) return "غير متوفر";
  return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function renderOrders() {
  const newestFirst = [...orders].sort((a, b) => orderTimeValue(b.createdAt || b.createdAtClient) - orderTimeValue(a.createdAt || a.createdAtClient));
  const pending = newestFirst.filter((order) => order.status !== "completed");
  const completed = newestFirst.filter((order) => order.status === "completed");
  $("#emptyOrders").hidden = pending.length > 0;
  $("#emptyCompletedOrders").hidden = completed.length > 0;
  $("#ordersList").innerHTML = pending.map((order) => orderCard(order, false)).join("");
  $("#completedOrdersList").innerHTML = completed.map((order) => orderCard(order, true)).join("");
}

$("#addCategoryButton").addEventListener("click", () => setCategoryFormOpen(!categoryFormCard.classList.contains("open")));
[$("#closeCategoryForm"), $("#cancelCategoryButton")].forEach((button) => button.addEventListener("click", () => {
  setCategoryFormOpen(false);
  resetCategoryForm();
}));

categoryImageInput.addEventListener("change", () => {
  const file = categoryImageInput.files?.[0];
  if (!file) return;
  categoryImagePreview.src = URL.createObjectURL(file);
  categoryUploadArea.classList.add("has-image");
});

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!categoryForm.reportValidity()) return;
  const submit = categoryForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const uploaded = await uploadImage(categoryImageInput.files?.[0], "categories");
    if (editingCategoryId) {
      const current = categories.find((item) => item.docId === editingCategoryId);
      await updateDoc(doc(db, "categories", editingCategoryId), {
        name: $("#categoryName").value.trim(),
        image: uploaded?.url || current?.image || "",
        imagePath: uploaded?.path || current?.imagePath || "",
        updatedAt: serverTimestamp(),
      });
      showToast("تم تعديل القسم بنجاح");
    } else {
      await addDoc(collection(db, "categories"), {
        name: $("#categoryName").value.trim(), image: uploaded.url, imagePath: uploaded.path, createdAt: serverTimestamp(),
      });
      showToast("تم حفظ القسم في قاعدة البيانات");
    }
    resetCategoryForm();
    setCategoryFormOpen(false);
  } catch (error) {
    console.error(error);
    showToast(error.message || "تعذر حفظ القسم");
  } finally {
    submit.disabled = false;
  }
});

$("#savedCategories").addEventListener("click", (event) => {
  const card = event.target.closest("[data-category-id]");
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!card || !action) return;
  const category = categories.find((item) => item.docId === card.dataset.categoryId);
  if (!category) return;
  if (action === "delete") {
    deletingCategoryId = category.docId;
    deleteConfirmationStep = 1;
    $("#deleteDialogTitle").textContent = "حذف القسم؟";
    $("#deleteDialogText").textContent = `هل أنت متأكد من حذف قسم «${category.name}»؟`;
    $("#deleteConfirmButton").textContent = "تأكيد الحذف";
    $("#deleteDialog").classList.add("open");
    $("#deleteDialog").setAttribute("aria-hidden", "false");
    return;
  }
  editingCategoryId = category.docId;
  $("#categoryName").value = category.name;
  categoryImageInput.removeAttribute("required");
  categoryImagePreview.src = category.image;
  categoryUploadArea.classList.add("has-image");
  categoryFormCard.querySelector("h2").textContent = "تعديل القسم";
  categoryForm.querySelector(".save-category-button span").textContent = "حفظ التعديل";
  setCategoryFormOpen(true);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function closeDeleteDialog() {
  $("#deleteDialog").classList.remove("open");
  $("#deleteDialog").setAttribute("aria-hidden", "true");
  deletingCategoryId = null;
  deleteConfirmationStep = 1;
}

$("#deleteCancelButton").addEventListener("click", closeDeleteDialog);
$("#deleteConfirmButton").addEventListener("click", async () => {
  if (deleteConfirmationStep === 1) {
    deleteConfirmationStep = 2;
    $("#deleteDialogTitle").textContent = "تأكيد نهائي";
    $("#deleteDialogText").textContent = "سيُحذف القسم نهائيًا. اضغط مرة ثانية للتأكيد.";
    $("#deleteConfirmButton").textContent = "نعم، احذف نهائيًا";
    return;
  }
  try {
    const category = categories.find((item) => item.docId === deletingCategoryId);
    await deleteDoc(doc(db, "categories", deletingCategoryId));
    await deleteImage(category?.imagePath);
    closeDeleteDialog();
    showToast("تم حذف القسم");
  } catch (error) {
    console.error(error);
    showToast("تعذر حذف القسم");
  }
});

const productFormCard = $("#productFormCard");
const productForm = $("#productForm");
const productImageInput = $("#productImage");
const productImagePreview = $("#productImagePreview");
const productImageUploadArea = $("#productImageUploadArea");
const productPriceInput = $("#productPrice");
const productDiscountInput = $("#productDiscount");
const productStockInput = $("#productStock");
const productMaterialTypeSelect = $("#productMaterialType");
const customMaterialTypeBox = $("#customMaterialTypeBox");
const customMaterialTypeInput = $("#customMaterialTypeInput");
const customMaterialTypeError = $("#customMaterialTypeError");
const productVariantsList = $("#productVariantsList");
const productVariantsEmpty = $("#productVariantsEmpty");
const deliveryCostForm = $("#deliveryCostForm");
const deliveryCostInput = $("#deliveryCostInput");
const priceInputFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function normalizeMaterialName(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\+\s*/g, "+")
    .slice(0, 40);
  return DEFAULT_MATERIAL_TYPES.find((type) => type.toLowerCase() === cleaned.toLowerCase()) || cleaned;
}

function availableMaterialTypes(selectedValue = "") {
  const materials = new Map(DEFAULT_MATERIAL_TYPES.map((type) => [type.toLowerCase(), type]));
  products.forEach((product) => {
    const material = normalizeMaterialName(product.materialType);
    if (material) materials.set(material.toLowerCase(), material);
  });
  customMaterialTypes.forEach((type) => materials.set(type.toLowerCase(), type));
  const selected = normalizeMaterialName(selectedValue);
  if (selected) materials.set(selected.toLowerCase(), selected);
  const custom = [...materials.values()]
    .filter((type) => !DEFAULT_MATERIAL_TYPES.some((defaultType) => defaultType.toLowerCase() === type.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  return [...DEFAULT_MATERIAL_TYPES, ...custom];
}

function renderMaterialTypeOptions(selectedValue = productMaterialTypeSelect.value) {
  const selected = normalizeMaterialName(selectedValue);
  productMaterialTypeSelect.innerHTML = '<option value="">بدون نوع مادة</option>'
    + availableMaterialTypes(selected).map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  productMaterialTypeSelect.value = selected;
  if (!selected) productMaterialTypeSelect.selectedIndex = 0;
}

function closeCustomMaterialType() {
  customMaterialTypeBox.hidden = true;
  customMaterialTypeInput.value = "";
  customMaterialTypeError.textContent = "";
  $("#addMaterialTypeButton").setAttribute("aria-expanded", "false");
}

function saveCustomMaterialType() {
  const material = normalizeMaterialName(customMaterialTypeInput.value);
  if (material.length < 2) {
    customMaterialTypeError.textContent = "اكتب اسمًا من حرفين على الأقل";
    customMaterialTypeInput.focus();
    return;
  }
  const existing = availableMaterialTypes().find((type) => type.toLowerCase() === material.toLowerCase());
  const savedMaterial = existing || material;
  if (!existing) customMaterialTypes.add(savedMaterial);
  renderMaterialTypeOptions(savedMaterial);
  closeCustomMaterialType();
  showToast(existing ? `نوع المادة «${savedMaterial}» موجود وتم اختياره` : `تمت إضافة نوع المادة «${savedMaterial}»`);
}

$("#addMaterialTypeButton").addEventListener("click", () => {
  const willOpen = customMaterialTypeBox.hidden;
  customMaterialTypeBox.hidden = !willOpen;
  $("#addMaterialTypeButton").setAttribute("aria-expanded", String(willOpen));
  customMaterialTypeError.textContent = "";
  if (willOpen) customMaterialTypeInput.focus();
});
$("#saveCustomMaterialType").addEventListener("click", saveCustomMaterialType);
$("#cancelCustomMaterialType").addEventListener("click", closeCustomMaterialType);
customMaterialTypeInput.addEventListener("input", () => { customMaterialTypeError.textContent = ""; });
customMaterialTypeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveCustomMaterialType();
  }
  if (event.key === "Escape") closeCustomMaterialType();
});

function createVariantId() {
  return `color-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clearVariantDraftPreviews() {
  productVariantsDraft.forEach((variant) => {
    if (variant.previewUrl) URL.revokeObjectURL(variant.previewUrl);
  });
}

function syncProductStockMode() {
  const hasVariants = productVariantsDraft.length > 0;
  productStockInput.disabled = hasVariants;
  productStockInput.required = !hasVariants;
  productStockInput.closest(".stock-field")?.classList.toggle("is-calculated", hasVariants);
  const unit = productStockInput.nextElementSibling;
  if (unit) unit.textContent = hasVariants ? "تلقائي" : "قطعة";
  if (hasVariants) {
    productStockInput.value = productVariantsDraft.reduce((sum, variant) => sum + normalizeStock(variant.stock), 0);
    productImageInput.removeAttribute("required");
  } else if (!editingProductId || !productImagePreview.getAttribute("src")) {
    productImageInput.setAttribute("required", "");
  }
}

function renderProductVariantsEditor() {
  productVariantsEmpty.hidden = productVariantsDraft.length > 0;
  productVariantsList.innerHTML = productVariantsDraft.map((variant, index) => `
    <article class="product-variant-row" data-variant-id="${escapeHtml(variant.id)}">
      <div class="variant-row-head"><strong>اللون ${index + 1}</strong><button type="button" data-remove-variant aria-label="حذف اللون">×</button></div>
      <div class="variant-fields-grid">
        <label><span>اسم اللون</span><input type="text" data-variant-name value="${escapeHtml(variant.name)}" placeholder="مثال: أسود" required></label>
        <label><span>درجة اللون</span><input type="color" data-variant-color value="${escapeHtml(variant.color)}" aria-label="درجة اللون"></label>
        <label><span>الكمية</span><input type="number" data-variant-stock value="${normalizeStock(variant.stock)}" min="0" step="1" required></label>
      </div>
      <label class="variant-image-upload">
        <input type="file" data-variant-file accept="image/png,image/jpeg,image/webp">
        ${variant.previewUrl || variant.image ? `<img src="${escapeHtml(variant.previewUrl || variant.image)}" alt="صورة ${escapeHtml(variant.name || `اللون ${index + 1}`)}">` : '<span>＋ رفع صورة هذا اللون</span>'}
      </label>
    </article>`).join("");
  syncProductStockMode();
}

$("#addProductVariant").addEventListener("click", () => {
  productVariantsDraft.push({ id: createVariantId(), name: "", color: "#111111", image: "", imagePath: "", stock: 0, file: null, previewUrl: "" });
  renderProductVariantsEditor();
  productVariantsList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

productVariantsList.addEventListener("input", (event) => {
  const row = event.target.closest("[data-variant-id]");
  const variant = productVariantsDraft.find((item) => item.id === row?.dataset.variantId);
  if (!variant) return;
  if (event.target.matches("[data-variant-name]")) variant.name = event.target.value;
  if (event.target.matches("[data-variant-color]")) variant.color = event.target.value;
  if (event.target.matches("[data-variant-stock]")) {
    variant.stock = normalizeStock(event.target.value);
    syncProductStockMode();
  }
});

productVariantsList.addEventListener("change", (event) => {
  if (!event.target.matches("[data-variant-file]")) return;
  const row = event.target.closest("[data-variant-id]");
  const variant = productVariantsDraft.find((item) => item.id === row?.dataset.variantId);
  const file = event.target.files?.[0];
  if (!variant || !file) return;
  if (variant.previewUrl) URL.revokeObjectURL(variant.previewUrl);
  variant.file = file;
  variant.previewUrl = URL.createObjectURL(file);
  renderProductVariantsEditor();
});

productVariantsList.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-variant]");
  if (!removeButton) return;
  const row = removeButton.closest("[data-variant-id]");
  const index = productVariantsDraft.findIndex((item) => item.id === row?.dataset.variantId);
  if (index < 0) return;
  if (productVariantsDraft[index].previewUrl) URL.revokeObjectURL(productVariantsDraft[index].previewUrl);
  productVariantsDraft.splice(index, 1);
  renderProductVariantsEditor();
});

function parsePriceInput(value) {
  const normalizedDigits = String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    .replace(/[۰-۹]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹".indexOf(digit));
  const digitsOnly = normalizedDigits.replace(/[^0-9]/g, "");
  return digitsOnly ? Number(digitsOnly) : 0;
}

function formatPriceInput(input) {
  const numericValue = parsePriceInput(input.value);
  input.value = input.value && numericValue === 0
    ? "0"
    : numericValue ? priceInputFormatter.format(numericValue) : "";
}

productPriceInput.addEventListener("input", () => formatPriceInput(productPriceInput));
productDiscountInput.addEventListener("input", () => {
  productDiscountInput.setCustomValidity("");
  formatPriceInput(productDiscountInput);
});
deliveryCostInput.addEventListener("input", () => formatPriceInput(deliveryCostInput));

deliveryCostForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!deliveryCostForm.reportValidity()) return;
  const submit = deliveryCostForm.querySelector('button[type="submit"]');
  const deliveryCost = parsePriceInput(deliveryCostInput.value);
  submit.disabled = true;
  try {
    await setDoc(doc(db, "settings", "store"), {
      deliveryCost,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    showToast("تم تحديث كلفة التوصيل في المتجر");
  } catch (error) {
    console.error(error);
    showToast("تعذر حفظ كلفة التوصيل");
  } finally {
    submit.disabled = false;
  }
});

function setProductFormOpen(isOpen) {
  productFormCard.classList.toggle("open", isOpen);
  productFormCard.setAttribute("aria-hidden", String(!isOpen));
  $("#addProductButton").setAttribute("aria-expanded", String(isOpen));
  if (isOpen) window.setTimeout(() => $("#productName")?.focus(), 180);
}

function resetProductForm() {
  clearVariantDraftPreviews();
  productVariantsDraft = [];
  productForm.reset();
  renderMaterialTypeOptions("");
  closeCustomMaterialType();
  productDiscountInput.setCustomValidity("");
  editingProductId = null;
  productImageInput.setAttribute("required", "");
  productImagePreview.removeAttribute("src");
  productImageUploadArea.classList.remove("has-image");
  renderProductVariantsEditor();
  productFormCard.querySelector("h2").textContent = "منتج جديد";
  productForm.querySelector('.save-category-button span').textContent = "حفظ المنتج";
}

$("#addProductButton").addEventListener("click", () => setProductFormOpen(!productFormCard.classList.contains("open")));
[$("#closeProductForm"), $("#cancelProductButton")].forEach((button) => button.addEventListener("click", () => {
  setProductFormOpen(false);
  resetProductForm();
}));

productImageInput.addEventListener("change", () => {
  const file = productImageInput.files?.[0];
  if (!file) return;
  productImagePreview.src = URL.createObjectURL(file);
  productImageUploadArea.classList.add("has-image");
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!productForm.reportValidity()) return;
  const submit = productForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const selectedCategory = categories.find((item) => item.docId === $("#productCategory").value);
    const currentProduct = products.find((item) => item.docId === editingProductId);
    const price = parsePriceInput(productPriceInput.value);
    const oldPrice = parsePriceInput(productDiscountInput.value);
    const missingVariantImage = productVariantsDraft.find((variant) => !variant.file && !variant.image);
    if (missingVariantImage) throw new Error(`ارفع صورة للون «${missingVariantImage.name || "الجديد"}»`);
    const emptyVariantName = productVariantsDraft.find((variant) => !String(variant.name || "").trim());
    if (emptyVariantName) throw new Error("اكتب اسم كل لون قبل الحفظ");
    if (oldPrice > 0 && oldPrice <= price) {
      productDiscountInput.setCustomValidity("السعر قبل الخصم يجب أن يكون أعلى من السعر الحالي");
      productDiscountInput.reportValidity();
      return;
    }
    productDiscountInput.setCustomValidity("");
    const variants = await Promise.all(productVariantsDraft.map(async (variant) => {
      const variantUpload = variant.file ? await uploadImage(variant.file, "products") : null;
      return {
        id: variant.id,
        name: String(variant.name).trim(),
        color: variant.color,
        image: variantUpload?.url || variant.image,
        imagePath: variantUpload?.path || variant.imagePath || "",
        stock: normalizeStock(variant.stock),
      };
    }));
    const stock = variants.length
      ? variants.reduce((sum, variant) => sum + variant.stock, 0)
      : normalizeStock(productStockInput.value);
    const newImageFile = productImageInput.files?.[0];
    const uploaded = newImageFile ? await uploadImage(newImageFile, "products") : null;
    const fallbackVariant = variants[0];
    const productData = {
      name: $("#productName").value.trim(),
      description: $("#productDescription").value.trim(),
      category: selectedCategory?.docId || "other",
      categoryLabel: selectedCategory?.name || "أخرى",
      materialType: normalizeMaterialName(productMaterialTypeSelect.value),
      image: uploaded?.url || currentProduct?.image || fallbackVariant?.image || "",
      imagePath: uploaded?.path || currentProduct?.imagePath || fallbackVariant?.imagePath || "",
      price,
      oldPrice: oldPrice || null,
      discount: null,
      stock,
      variants,
    };

    if (editingProductId) {
      await updateDoc(doc(db, "products", editingProductId), {
        ...productData,
        updatedAt: serverTimestamp(),
      });
      const retainedPaths = new Set([productData.imagePath, ...variants.map((variant) => variant.imagePath)].filter(Boolean));
      const previousPaths = new Set([currentProduct?.imagePath, ...normalizeVariants(currentProduct).map((variant) => variant.imagePath)].filter(Boolean));
      await Promise.all([...previousPaths].filter((path) => !retainedPaths.has(path)).map(async (path) => {
        try { await deleteImage(path); } catch (imageDeleteError) { console.warn("تعذر حذف صورة قديمة", imageDeleteError); }
      }));
      showToast("تم تعديل المنتج بنجاح");
    } else {
      await addDoc(collection(db, "products"), {
        id: Date.now(),
        ...productData,
        rating: 5,
        reviews: 0,
        badge: "جديد",
        color: "#f6aa1c",
        icon: "spool",
        active: true,
        createdAt: serverTimestamp(),
      });
      showToast("تم حفظ المنتج وسيظهر فورًا عند الزبون");
    }
    resetProductForm();
    setProductFormOpen(false);
  } catch (error) {
    console.error(error);
    showToast(error.message || "تعذر حفظ المنتج");
  } finally {
    submit.disabled = false;
  }
});

$("#savedProducts").addEventListener("click", async (event) => {
  const card = event.target.closest("[data-product-id]");
  if (!card) return;
  const editButton = event.target.closest("[data-edit-product]");
  const deleteButton = event.target.closest("[data-delete-product]");
  if (!editButton && !deleteButton) return;
  const product = products.find((item) => item.docId === card.dataset.productId);
  if (!product) return;

  if (editButton) {
    clearVariantDraftPreviews();
    productForm.reset();
    editingProductId = product.docId;
    $("#productName").value = product.name || "";
    $("#productDescription").value = product.description || "";
    $("#productCategory").value = product.category || "";
    renderMaterialTypeOptions(product.materialType || "");
    const pricing = productPricing(product);
    productPriceInput.value = priceInputFormatter.format(pricing.current);
    productDiscountInput.value = pricing.before ? priceInputFormatter.format(pricing.before) : "";
    productVariantsDraft = normalizeVariants(product).map((variant) => ({ ...variant, file: null, previewUrl: "" }));
    productStockInput.value = normalizeStock(product.stock);
    productImageInput.removeAttribute("required");
    if (product.image) {
      productImagePreview.src = product.image;
      productImageUploadArea.classList.add("has-image");
    } else {
      productImagePreview.removeAttribute("src");
      productImageUploadArea.classList.remove("has-image");
    }
    productFormCard.querySelector("h2").textContent = "تعديل المنتج";
    productForm.querySelector('.save-category-button span').textContent = "حفظ التعديل";
    renderProductVariantsEditor();
    setProductFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  deletingProductId = product.docId;
  $("#productDeleteName").textContent = product.name || "المنتج";
  const deletePreviewImage = $("#productDeleteImage");
  if (product.image) {
    deletePreviewImage.src = product.image;
    deletePreviewImage.alt = product.name || "صورة المنتج";
    deletePreviewImage.hidden = false;
  } else {
    deletePreviewImage.removeAttribute("src");
    deletePreviewImage.hidden = true;
  }
  $("#productDeleteDialog").classList.add("open");
  $("#productDeleteDialog").setAttribute("aria-hidden", "false");
  window.setTimeout(() => $("#productDeleteCancel").focus(), 120);
});

function closeProductDeleteDialog() {
  $("#productDeleteDialog").classList.remove("open");
  $("#productDeleteDialog").setAttribute("aria-hidden", "true");
  deletingProductId = null;
}

$("#productDeleteCancel").addEventListener("click", closeProductDeleteDialog);
$("#productDeleteDialog").addEventListener("click", (event) => {
  if (event.target === $("#productDeleteDialog")) closeProductDeleteDialog();
});
$("#productDeleteConfirm").addEventListener("click", async () => {
  const product = products.find((item) => item.docId === deletingProductId);
  if (!product) {
    closeProductDeleteDialog();
    showToast("المنتج غير موجود");
    return;
  }
  const confirmButton = $("#productDeleteConfirm");
  confirmButton.disabled = true;
  confirmButton.querySelector("span").textContent = "جارٍ الحذف...";
  try {
    await deleteDoc(doc(db, "products", product.docId));
    const imagePaths = new Set([product.imagePath, ...normalizeVariants(product).map((variant) => variant.imagePath)].filter(Boolean));
    await Promise.allSettled([...imagePaths].map((path) => deleteImage(path)));
    closeProductDeleteDialog();
    showToast("تم حذف المنتج بنجاح");
  } catch (error) {
    console.error(error);
    showToast("تعذر حذف المنتج");
  } finally {
    confirmButton.disabled = false;
    confirmButton.querySelector("span").textContent = "حذف المنتج";
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#productDeleteDialog").classList.contains("open")) closeProductDeleteDialog();
});

async function handleOrderAction(event) {
  const card = event.target.closest("[data-order-id]");
  if (!card) return;
  const completeButton = event.target.closest(".complete-order-button");
  const deleteButton = event.target.closest(".delete-order-button");
  if (!completeButton && !deleteButton) return;

  if (deleteButton) {
    if (deleteButton.dataset.confirmDelete !== "true") {
      deleteButton.dataset.confirmDelete = "true";
      deleteButton.classList.add("is-confirming");
      deleteButton.textContent = "اضغط مرة ثانية للتأكيد";
      window.setTimeout(() => {
        if (!deleteButton.isConnected) return;
        deleteButton.dataset.confirmDelete = "false";
        deleteButton.classList.remove("is-confirming");
        deleteButton.textContent = "حذف الطلب";
      }, 5000);
      return;
    }
    deleteButton.disabled = true;
    deleteButton.textContent = "جارٍ الحذف...";
    try {
      await deleteDoc(doc(db, "orders", card.dataset.orderId));
      showToast("تم حذف الطلب");
    } catch (error) {
      console.error(error);
      showToast("تعذر حذف الطلب");
      deleteButton.disabled = false;
      deleteButton.dataset.confirmDelete = "false";
      deleteButton.classList.remove("is-confirming");
      deleteButton.textContent = "حذف الطلب";
    }
    return;
  }

  try {
    completeButton.disabled = true;
    completeButton.textContent = "جارٍ فحص المخزون...";
    const orderReference = doc(db, "orders", card.dataset.orderId);
    const result = await runTransaction(db, async (transaction) => {
      const orderSnapshot = await transaction.get(orderReference);
      if (!orderSnapshot.exists()) throw new Error("الطلب غير موجود");
      const order = orderSnapshot.data();
      if (order.status === "completed" || order.inventoryApplied === true) return "already-completed";

      const groupedItems = new Map();
      (Array.isArray(order.items) ? order.items : []).forEach((item) => {
        const productDocId = item.productDocId || products.find((product) => Number(product.id) === Number(item.id))?.docId || "";
        if (!productDocId) throw new Error(`تعذر العثور على المنتج: ${item.name || "منتج محذوف"}`);
        const saved = groupedItems.get(productDocId) || { legacyQuantity: 0, variantQuantities: new Map(), name: item.name || "المنتج" };
        const quantity = Math.max(0, Number(item.quantity) || 0);
        if (item.variantId) {
          saved.variantQuantities.set(String(item.variantId), (saved.variantQuantities.get(String(item.variantId)) || 0) + quantity);
        } else {
          saved.legacyQuantity += quantity;
        }
        groupedItems.set(productDocId, saved);
      });

      const inventory = [...groupedItems.entries()].map(([productDocId, item]) => ({
        ...item,
        reference: doc(db, "products", productDocId),
      }));
      const inventorySnapshots = await Promise.all(inventory.map((item) => transaction.get(item.reference)));

      inventory.forEach((item, index) => {
        const productSnapshot = inventorySnapshots[index];
        if (!productSnapshot.exists()) throw new Error(`المنتج غير موجود: ${item.name}`);
        const productData = productSnapshot.data();
        const variants = normalizeVariants(productData);
        if (variants.length) {
          item.variantQuantities.forEach((quantity, variantId) => {
            const variant = variants.find((candidate) => candidate.id === variantId);
            if (!variant) throw new Error(`اللون المحدد غير موجود للمنتج «${item.name}»`);
            if (variant.stock < quantity) throw new Error(`مخزون لون «${variant.name}» غير كافٍ — المتوفر ${variant.stock}`);
            variant.stock -= quantity;
          });
          let remainingLegacy = item.legacyQuantity;
          if (variants.reduce((sum, variant) => sum + variant.stock, 0) < remainingLegacy) {
            throw new Error(`المخزون غير كافٍ للمنتج «${item.name}»`);
          }
          variants.forEach((variant) => {
            const deducted = Math.min(variant.stock, remainingLegacy);
            variant.stock -= deducted;
            remainingLegacy -= deducted;
          });
          transaction.update(item.reference, {
            variants,
            stock: variants.reduce((sum, variant) => sum + variant.stock, 0),
            updatedAt: serverTimestamp(),
          });
          return;
        }
        const requested = item.legacyQuantity + [...item.variantQuantities.values()].reduce((sum, quantity) => sum + quantity, 0);
        const stock = normalizeStock(productData.stock);
        if (stock < requested) throw new Error(`المخزون غير كافٍ للمنتج «${item.name}» — المتوفر ${stock}`);
        transaction.update(item.reference, { stock: stock - requested, updatedAt: serverTimestamp() });
      });
      transaction.update(orderReference, {
        status: "completed",
        completedAt: serverTimestamp(),
        inventoryApplied: true,
      });
      return "completed";
    });
    showToast(result === "already-completed" ? "الطلب مكتمل والمخزون مخصوم مسبقًا" : "تمت الموافقة وخصم الكمية من المخزون");
    activatePage("completed-orders");
  } catch (error) {
    console.error(error);
    showToast(error.message || "تعذر إكمال الطلب وتحديث المخزون");
    completeButton.disabled = false;
    completeButton.textContent = "✓ موافقة الطلب وخصم المخزون";
  }
}

$("#ordersList").addEventListener("click", handleOrderAction);
$("#completedOrdersList").addEventListener("click", handleOrderAction);

function subscribe(name, onData) {
  return onSnapshot(collection(db, name), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ docId: item.id, ...item.data() })));
  }, (error) => {
    console.error(`Firebase ${name}:`, error);
    showToast("تعذر الاتصال بقاعدة البيانات. تحقق من Firestore Rules");
  });
}

subscribe("categories", (items) => { categories = items; renderCategories(); });
subscribe("products", (items) => {
  products = items;
  renderMaterialTypeOptions(productMaterialTypeSelect.value);
  renderProducts();
});
subscribe("orders", (items) => { orders = items; renderOrders(); });
onSnapshot(doc(db, "settings", "store"), (snapshot) => {
  const savedCost = Number(snapshot.data()?.deliveryCost);
  const deliveryCost = Number.isFinite(savedCost) && savedCost >= 0 ? savedCost : 5000;
  deliveryCostInput.value = priceInputFormatter.format(deliveryCost);
  $("#currentDeliveryCost").textContent = money(deliveryCost);
}, (error) => {
  console.error("Firebase delivery settings:", error);
  showToast("تعذر تحميل كلفة التوصيل");
});
renderCategories();
renderMaterialTypeOptions();
renderProducts();
renderOrders();
