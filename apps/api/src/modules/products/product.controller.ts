import { Request, Response } from 'express';
import { productService } from './product.service';
import { CreateProductSchema, UpdateProductSchema, ProductQuerySchema, CreateCategorySchema, CreateUnitSchema, CreateBrandSchema } from './product.dto';
import { successResponse, paginatedResponse } from '../../shared/helpers/response.helper';

export class ProductController {
  list = async (req: Request, res: Response) => {
    const query = ProductQuerySchema.parse(req.query);
    const result = await productService.listProducts(req.organizationId!, query);
    res.json(successResponse({ products: result.data, total: result.meta.total, page: result.meta.page, totalPages: result.meta.totalPages }));
  };
  create = async (req: Request, res: Response) => {
    const input = CreateProductSchema.parse(req.body);
    const product = await productService.createProduct(req.organizationId!, input);
    res.status(201).json(successResponse(product, 'Product created successfully'));
  };
  getById = async (req: Request, res: Response) => {
    const product = await productService.getProduct(req.organizationId!, req.params.id);
    res.json(successResponse(product));
  };
  update = async (req: Request, res: Response) => {
    const input = UpdateProductSchema.parse(req.body);
    const product = await productService.updateProduct(req.organizationId!, req.params.id, input);
    res.json(successResponse(product, 'Product updated successfully'));
  };
  delete = async (req: Request, res: Response) => {
    const result = await productService.deleteProduct(req.organizationId!, req.params.id);
    res.json(successResponse(result));
  };
  getStockHistory = async (req: Request, res: Response) => {
    const { page, limit } = req.query as any;
    const result = await productService.getStockHistory(req.organizationId!, req.params.id, +page || 1, +limit || 20);
    res.json(paginatedResponse(result.data, result.meta));
  };
  getLowStock = async (req: Request, res: Response) => {
    const result = await productService.getLowStockProducts(req.organizationId!);
    res.json(successResponse(result));
  };
  // Categories
  listCategories = async (req: Request, res: Response) => {
    const result = await productService.listCategories(req.organizationId!);
    res.json(successResponse(result));
  };
  createCategory = async (req: Request, res: Response) => {
    const input = CreateCategorySchema.parse(req.body);
    const result = await productService.createCategory(req.organizationId!, input);
    res.status(201).json(successResponse(result));
  };
  // Units
  listUnits = async (req: Request, res: Response) => {
    const result = await productService.listUnits(req.organizationId!);
    res.json(successResponse(result));
  };
  createUnit = async (req: Request, res: Response) => {
    const input = CreateUnitSchema.parse(req.body);
    const result = await productService.createUnit(req.organizationId!, input);
    res.status(201).json(successResponse(result));
  };
  // Brands
  listBrands = async (req: Request, res: Response) => {
    const result = await productService.listBrands(req.organizationId!);
    res.json(successResponse(result));
  };
  createBrand = async (req: Request, res: Response) => {
    const input = CreateBrandSchema.parse(req.body);
    const result = await productService.createBrand(req.organizationId!, input);
    res.status(201).json(successResponse(result));
  };
}
export const productController = new ProductController();
