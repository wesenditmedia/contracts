// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./EmergencyGuard.sol";
import "./interfaces/IWeSenditToken.sol";

/**
 * @title Base Dynamic Fee Manager
 */
abstract contract BaseDynamicFeeManager is
    IDynamicFeeManager,
    EmergencyGuard,
    AccessControlEnumerable,
    Ownable,
    ReentrancyGuard
{
    // Role allowed to do admin operations like adding to fee whitelist, withdraw, etc.
    bytes32 public constant ADMIN = keccak256("ADMIN");

    // Fee divider
    uint256 internal constant FEE_DIVIDER = 100000;

    // Wildcard address for fees
    address internal constant WHITELIST_ADDRESS =
        0x000000000000000000000000000000000000dEaD;

    // List of all currently added fees
    FeeEntry[] internal _fees;

    // Mapping id to current liquify or swap amounts
    mapping(bytes32 => uint256) internal _amounts;

    // Pancake Router address
    IPancakeRouter02 private _pancakeRouter =
        IPancakeRouter02(address(0x10ED43C718714eb63d5aA57B78B54704E256024E));

    // BUSD address
    address private _busdAddress;

    constructor() {
        // Add creator to admin role
        _setupRole(ADMIN, _msgSender());

        // Set role admin for admin role
        _setRoleAdmin(ADMIN, ADMIN);
    }

    function getFee(uint256 index)
        public
        view
        override
        returns (FeeEntry memory fee)
    {
        return _fees[index];
    }

    function getFeeAmount(bytes32 id) public view returns (uint256 amount) {
        return _amounts[id];
    }

    function pancakeRouter()
        public
        view
        override
        returns (IPancakeRouter02 value)
    {
        return _pancakeRouter;
    }

    function setPancakeRouter(address value) public override onlyRole(ADMIN) {
        _pancakeRouter = IPancakeRouter02(value);
        emit PancakeRouterUpdated(value);
    }

    function busdAddress() public view override returns (address value) {
        return _busdAddress;
    }

    function setBusdAddress(address value) public override onlyRole(ADMIN) {
        _busdAddress = value;
        emit BusdAddressUpdated(value);
    }

    function emergencyWithdraw(uint256 amount) public override onlyRole(ADMIN) {
        super._emergencyWithdraw(amount);
    }

    function emergencyWithdrawToken(address token, uint256 amount)
        public
        override
        onlyRole(ADMIN)
    {
        super._emergencyWithdrawToken(token, amount);
    }
}
