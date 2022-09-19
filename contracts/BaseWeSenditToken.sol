// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "./interfaces/IWeSenditToken.sol";
import "./interfaces/IPancakeRouter.sol";

abstract contract BaseWeSenditToken is IWeSenditToken, AccessControlEnumerable {
    uint256 public constant INITIAL_SUPPLY = 37500000 * 1 ether;
    uint256 public constant TOTAL_SUPPLY = 1500000000 * 1 ether;

    // Role allowed to do admin operations like adding to fee whitelist, withdraw, etc.
    bytes32 public constant ADMIN = keccak256("ADMIN");
    // Role allowed to bypass fees
    bytes32 public constant FEE_WHITELIST = keccak256("FEE_WHITELIST");
    // Role allowed to token be sent to without fee
    bytes32 public constant RECEIVER_FEE_WHITELIST =
        keccak256("RECEIVER_FEE_WHITELIST");
    // Role allowed to bypass pause
    bytes32 public constant BYPASS_PAUSE = keccak256("BYPASS_PAUSE");
    // Role allowed to bypass swap and liquify
    bytes32 public constant BYPASS_SWAP_AND_LIQUIFY =
        keccak256("BYPASS_SWAP_AND_LIQUIFY");

    uint256 private _minTxAmount = 0;
    bool private _paused = false;
    IPancakeRouter02 private _pancakeRouter =
        IPancakeRouter02(address(0x10ED43C718714eb63d5aA57B78B54704E256024E));
    bool private _feesEnabled = false;
    bool private _swapAndLiquifyEnabled = false;
    uint256 private _swapAndLiquifyBalance = 0;
    IDynamicFeeManager private _dynamicFeeManager;

    constructor() {
        _setupRole(ADMIN, _msgSender());
        _setRoleAdmin(ADMIN, ADMIN);
        _setRoleAdmin(FEE_WHITELIST, ADMIN);
        _setRoleAdmin(BYPASS_PAUSE, ADMIN);
        _setRoleAdmin(RECEIVER_FEE_WHITELIST, ADMIN);
        _setRoleAdmin(BYPASS_SWAP_AND_LIQUIFY, ADMIN);
    }

    /**
     * Getter & Setter
     */
    function initialSupply() public pure override returns (uint256) {
        return INITIAL_SUPPLY;
    }

    function minTxAmount() public view override returns (uint256) {
        return _minTxAmount;
    }

    function setMinTxAmount(uint256 value) public override onlyRole(ADMIN) {
        _minTxAmount = value;
        emit MinTxAmountUpdated(value);
    }

    function paused() public view override returns (bool) {
        return _paused;
    }

    function setPaused(bool value) public override onlyRole(ADMIN) {
        _paused = value;
        emit PausedUpdated(value);
    }

    function pancakeRouter()
        public
        view
        override
        returns (IPancakeRouter02 router)
    {
        return _pancakeRouter;
    }

    function setPancakeRouter(address value) public override onlyRole(ADMIN) {
        _pancakeRouter = IPancakeRouter02(value);
        emit PancakeRouterUpdated(value);
    }

    function swapAndLiquifyEnabled() public view override returns (bool) {
        return _swapAndLiquifyEnabled;
    }

    function setSwapAndLiquifyEnabled(bool value)
        public
        override
        onlyRole(ADMIN)
    {
        _swapAndLiquifyEnabled = value;
        emit SwapAndLiquifyEnabledUpdated(value);
    }

    function swapAndLiquifyBalance() public view override returns (uint256) {
        return _swapAndLiquifyBalance;
    }

    function setSwapAndLiquifyBalance(uint256 value) public override {
        _swapAndLiquifyBalance = value;
        emit SwapAndLiquifyBalanceUpdated(value);
    }

    function feesEnabled() public view override returns (bool) {
        return _feesEnabled;
    }

    function setFeesEnabled(bool value) public override onlyRole(ADMIN) {
        _feesEnabled = value;
    }

    function dynamicFeeManager()
        public
        view
        override
        returns (IDynamicFeeManager dynamicFeeManager)
    {
        return _dynamicFeeManager;
    }

    function setDynamicFeeManager(address value) public override onlyRole(ADMIN) {
        _dynamicFeeManager = IDynamicFeeManager(value);
        emit DynamicFeeManagerUpdated(value);
    }
}
